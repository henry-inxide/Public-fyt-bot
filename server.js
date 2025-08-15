const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const login = require('ws3-fca');

const app = express();
const PORT = process.env.PORT || 10000;

// In-memory bot state (not persistent, just for demo)
let botConfig = null;
let apiInstance = null;

// Serve static HTML form
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send(`
        <h2>🚀 Henry-x Bot: Advanced Lock System</h2>
        <form method="POST" action="/start-bot" enctype="multipart/form-data">
            <label>🔑 Upload your appstate.json file:</label><br>
            <input type="file" name="appstate" accept=".json" required /><br><br>
            <label>✏ Command Prefix (e.g., *):</label><br>
            <input type="text" name="prefix" required /><br><br>
            <label>👑 Admin ID:</label><br>
            <input type="text" name="adminID" required /><br><br>
            <button type="submit">Start Bot</button>
        </form>
        ${botConfig ? '<p>✅ Bot is running!</p>' : ''}
    `);
});

// Handle form and start bot
app.post('/start-bot', express.raw({ type: 'multipart/form-data', limit: '5mb' }), (req, res) => {
    // Parse the multipart form manually (simplified for Render demo)
    // In production, use 'multer' or similar for file uploads
    let body = req.body.toString();
    let prefixMatch = body.match(/name="prefix"\r\n\r\n([^\r\n]*)/);
    let adminIDMatch = body.match(/name="adminID"\r\n\r\n([^\r\n]*)/);
    let appstateMatch = body.match(/name="appstate"; filename=".*"\r\nContent-Type: application\/json\r\n\r\n([\s\S]*?)\r\n-/);

    if (!prefixMatch || !adminIDMatch || !appstateMatch) {
        return res.send('❌ Invalid form data. Please fill all fields.');
    }

    let prefix = prefixMatch[1].trim();
    let adminID = adminIDMatch[1].trim();
    let appState;
    try {
        appState = JSON.parse(appstateMatch[1]);
    } catch (e) {
        return res.send('❌ Invalid appstate.json file.');
    }

    botConfig = { appState, prefix, adminID };
    startBot(botConfig);

    res.redirect('/');
});

// Bot logic (from your script, adapted)
function startBot({ appState, prefix, adminID }) {
    if (apiInstance) return; // Prevent multiple bots

    login({ appState }, (err, api) => {
        if (err) return console.error('❌ Login failed:', err);

        console.log('\n✅ Bot is running and listening for commands...');
        api.setOptions({ listenEvents: true });
        apiInstance = api;

        const lockedGroups = {};
        const lockedNicknames = {};
        const lockedDPs = {};
        const lockedThemes = {};
        const lockedEmojis = {};

        api.listenMqtt((err, event) => {
            if (err) return console.error('❌ Listen error:', err);

            if (event.type === 'message' && event.body.startsWith(prefix)) {
                const senderID = event.senderID;
                const args = event.body.slice(prefix.length).trim().split(' ');
                const command = args[0].toLowerCase();
                const input = args.slice(1).join(' ');

                if (senderID !== adminID) {
                    return api.sendMessage('❌ You are not authorized to use this command.', event.threadID);
                }

                // Group Name Lock
                if (command === 'grouplockname' && args[1] === 'on') {
                    const groupName = input.replace('on', '').trim();
                    lockedGroups[event.threadID] = groupName;
                    api.setTitle(groupName, event.threadID, (err) => {
                        if (err) return api.sendMessage('❌ Failed to lock group name.', event.threadID);
                        api.sendMessage(`✅ Group name locked as: ${groupName}`, event.threadID);
                    });
                }

                // Nickname Lock
                if (command === 'nicknamelock' && args[1] === 'on') {
                    const nickname = input.replace('on', '').trim();
                    api.getThreadInfo(event.threadID, (err, info) => {
                        if (err) return console.error('❌ Error fetching thread info:', err);

                        info.participantIDs.forEach((userID) => {
                            api.changeNickname(nickname, event.threadID, userID, (err) => {
                                if (err) console.error(`❌ Failed to set nickname for user ${userID}:`, err);
                            });
                        });

                        lockedNicknames[event.threadID] = nickname;
                        api.sendMessage(`✅ Nicknames locked as: ${nickname}`, event.threadID);
                    });
                }

                // DP Lock
                if (command === 'groupdplock' && args[1] === 'on') {
                    lockedDPs[event.threadID] = true;
                    api.sendMessage('✅ Group DP locked. No changes allowed.', event.threadID);
                }

                // Themes Lock
                if (command === 'groupthemeslock' && args[1] === 'on') {
                    lockedThemes[event.threadID] = true;
                    api.sendMessage('✅ Group themes locked. No changes allowed.', event.threadID);
                }

                // Emoji Lock
                if (command === 'groupemojilock' && args[1] === 'on') {
                    lockedEmojis[event.threadID] = true;
                    api.sendMessage('✅ Group emoji locked. No changes allowed.', event.threadID);
                }

                // Fetch Group UID
                if (command === 'tid') {
                    api.sendMessage(`Group UID: ${event.threadID}`, event.threadID);
                }

                // Fetch User UID
                if (command === 'uid') {
                    api.sendMessage(`Your UID: ${senderID}`, event.threadID);
                }

                // Fight Mode
                if (command === 'fyt' && args[1] === 'on') {
                    api.sendMessage('🔥 Fight mode activated! Admin commands enabled.', event.threadID);
                }
            }

            // Revert Changes
            if (event.logMessageType) {
                const lockedName = lockedGroups[event.threadID];
                if (event.logMessageType === 'log:thread-name' && lockedName) {
                    api.setTitle(lockedName, event.threadID, () => {
                        api.sendMessage('❌ Group name change reverted.', event.threadID);
                    });
                }

                const lockedNickname = lockedNicknames[event.threadID];
                if (event.logMessageType === 'log:thread-nickname' && lockedNickname) {
                    const affectedUserID = event.logMessageData.participant_id;
                    api.changeNickname(lockedNickname, event.threadID, affectedUserID, () => {
                        api.sendMessage('❌ Nickname change reverted.', event.threadID);
                    });
                }

                if (event.logMessageType === 'log:thread-icon' && lockedEmojis[event.threadID]) {
                    api.changeThreadEmoji('😀', event.threadID, () => {
                        api.sendMessage('❌ Emoji change reverted.', event.threadID);
                    });
                }

                if (event.logMessageType === 'log:thread-theme' && lockedThemes[event.threadID]) {
                    api.sendMessage('❌ Theme change reverted.', event.threadID);
                }

                if (event.logMessageType === 'log:thread-image' && lockedDPs[event.threadID]) {
                    api.sendMessage('❌ Group DP change reverted.', event.threadID);
                }
            }
        });
    });
}

app.listen(PORT, () => {
    console.log(`🌐 Web panel running on http://localhost:${PORT}`);
});
