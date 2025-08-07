const express = require('express');
const bodyParser = require('body-parser');
const { login } = require('ws3-fca');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

let api = null;
let config = { admins: [], prefix: '/' };
let lockedNicknames = {};
let lockedGroupNames = {};

// HTML page for config
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/start', async (req, res) => {
  const { appState, adminUids, prefix } = req.body;
  config.admins = adminUids.split(',').map(uid => uid.trim());
  config.prefix = prefix;

  try {
    fs.writeFileSync('appstate.json', appState);
    api = await login({ appState: JSON.parse(appState) });

    api.listenMqtt(async (event) => {
      if (event.type !== 'message' || !event.body) return;
      const { threadID, senderID, body } = event;

      const isAdmin = config.admins.includes(senderID);
      const reply = (msg) => api.sendMessage(msg, threadID);

      // Group name lock
      if (event.logMessageType === 'log:thread-name' && lockedGroupNames[threadID]) {
        api.setTitle(lockedGroupNames[threadID], threadID);
        reply("Henry papa ne name rakha hai, change nahi hoga 🤣");
      }

      // Nickname lock
      if (event.logMessageType === 'log:user-nickname' && lockedNicknames[threadID]) {
        api.changeNickname(lockedNicknames[threadID][event.logMessageData.participant_id] || '', threadID, event.logMessageData.participant_id);
        reply("Naam lock hai. Henry papa se puchho 🤣");
      }

      if (!body.startsWith(config.prefix)) return;
      const cmd = body.slice(config.prefix.length).split(' ')[0];
      const args = body.slice(config.prefix.length + cmd.length).trim();

      if (cmd === 'groupname' && isAdmin) {
        lockedGroupNames[threadID] = args;
        api.setTitle(args, threadID);
        reply('Group name updated and locked!');
      }

      if (cmd === 'lockgroupname' && isAdmin) {
        lockedGroupNames[threadID] = await api.getThreadInfo(threadID).name;
        reply('Group name locked.');
      }

      if (cmd === 'allname' && isAdmin) {
        const users = await api.getThreadInfo(threadID);
        lockedNicknames[threadID] = {};
        for (let u of users.participantIDs) {
          lockedNicknames[threadID][u] = args;
          api.changeNickname(args, threadID, u);
        }
        reply('Sabka naam change kar diya gaya aur lock bhi ho gaya!');
      }

      if (cmd === 'help') {
        reply(`📚 Commands:
${config.prefix}groupname <name>
${config.prefix}lockgroupname
${config.prefix}allname <name>
${config.prefix}help`);
      }
    });

    res.send("🤖 Bot started successfully!");
  } catch (e) {
    console.error(e);
    res.status(500).send("Login failed: " + e.message);
  }
});

app.listen(port, () => console.log("Server running on port", port));
