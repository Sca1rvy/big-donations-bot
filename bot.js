// --------------
// IMPORTS
// --------------
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} = require("discord.js");

const WebSocket = require("ws");
const fetch = require("node-fetch");
const fs = require("fs");

// --------------
// CONFIG
// --------------
const DONATIONS_CHANNEL_ID = "1505956583690207402";

// --------------
// WEBSOCKET SERVER
// --------------
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

let donations = [];
let totals = {}; 

// --------------
// LOAD donations.json
// --------------
try {
    if (fs.existsSync("donations.json")) {
        donations = JSON.parse(fs.readFileSync("donations.json", "utf8") || "[]");
        console.log(`✅ donations.json carregado (${donations.length} doações).`);
    } else {
        fs.writeFileSync("donations.json", "[]");
        donations = [];
        console.log("ℹ️ donations.json criado vazio.");
    }
} catch (err) {
    console.log("❌ Erro ao carregar donations.json:", err);
    donations = [];
}

function saveDonations() {
    try {
        fs.writeFileSync("donations.json", JSON.stringify(donations, null, 2));
    } catch (err) {
        console.log("❌ Erro ao guardar donations.json:", err);
    }
}

// --------------
// REBUILD TOTALS
// --------------
function rebuildTotals() {
    totals = {};

    for (const d of donations) {
        if (!d.receiver || d.receiver.toLowerCase() !== "sca1rvy") continue;

        if (!totals[d.donator]) {
            totals[d.donator] = {
                total: 0,
                avatar: d.donatorAvatar
            };
        }

        totals[d.donator].total += d.amount;
        totals[d.donator].avatar = d.donatorAvatar;
    }

    console.log(`🔁 Totals reconstruídos (${Object.keys(totals).length} players).`);
}

function getTopDonatorsArray() {
    return Object.entries(totals)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([username, info], index) => ({
            rank: index + 1,
            username,
            total: info.total,
            avatar: info.avatar
        }));
}

function sendToSite(data) {
    const json = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(json);
    });
}

function broadcastTopDonators() {
    sendToSite({
        type: "topDonators",
        data: getTopDonatorsArray()
    });
}

// --------------
// WEBSOCKET CONNECTION
// --------------
wss.on("connection", (ws) => {
    console.log("🌐 Cliente ligado ao WebSocket.");

    ws.send(JSON.stringify({ type: "all", donations }));
    ws.send(JSON.stringify({ type: "topDonators", data: getTopDonatorsArray() }));
});

// --------------
// ROBLOX API
// --------------
async function getUserId(username) {
    try {
        const res = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username] })
        });

        const data = await res.json();
        return data.data?.[0]?.id || null;
    } catch {
        return null;
    }
}

async function getAvatar(userId) {
    if (!userId) return "Template.png";

    try {
        const res = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`
        );

        const data = await res.json();
        return data.data?.[0]?.imageUrl || "Template.png";
    } catch {
        return "Template.png";
    }
}

// --------------
// DISCORD BOT
// --------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --------------
// SLASH COMMANDS
// --------------
const commands = [
    new SlashCommandBuilder()
        .setName('checkonline')
        .setDescription('Verifica se o bot está online!'),

    new SlashCommandBuilder()
        .setName('dono')
        .setDescription('Regista uma doação')
        .addStringOption(o => o.setName('donator').setDescription('Nome do doador').setRequired(true))
        .addStringOption(o => o.setName('receiver').setDescription('Nome do recebedor').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Valor da doação').setRequired(true)),

    new SlashCommandBuilder()
        .setName('deletedono')
        .setDescription('Apaga uma doação pelo ID da mensagem')
        .addStringOption(o => o.setName('id').setDescription('ID da mensagem').setRequired(true)),

    new SlashCommandBuilder()
        .setName('rebuilddonos')
        .setDescription('Reconstrói todas as doações a partir do canal')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

// --------------
// SEND DONATION (CORRIGIDO)
// --------------
async function sendDonation(ws, donator, receiver, amount, messageId) {
    const donatorId = await getUserId(donator);
    const receiverId = await getUserId(receiver);

    const donatorAvatar = await getAvatar(donatorId);
    const receiverAvatar = await getAvatar(receiverId);

    const donation = {
        type: "single",
        donator,
        receiver,
        amount,
        donatorAvatar,
        receiverAvatar,
        timestamp: Date.now(),
        messageId
    };

    donations.unshift(donation);
    saveDonations();

    sendToSite(donation);

    if (receiver.toLowerCase() === "sca1rvy") {
        if (!totals[donator]) totals[donator] = { total: 0, avatar: donatorAvatar };
        totals[donator].total += amount;
        totals[donator].avatar = donatorAvatar;
        broadcastTopDonators();
    }
}

// --------------
// REBUILD FROM CHANNEL (CORRIGIDO)
// --------------
async function rebuildFromChannel() {
    try {
        const channel = await client.channels.fetch(DONATIONS_CHANNEL_ID);
        if (!channel) {
            console.log("❌ Canal de doações inválido.");
            return 0;
        }

        console.log("📥 A reconstruir doações a partir do canal...");

        let lastId = null;
        const newDonations = [];
        let count = 0;

        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;

            const messages = await channel.messages.fetch(options);
            if (messages.size === 0) break;

            for (const msg of messages.values()) {
                if (msg.author.id !== client.user.id) continue;
                if (!msg.content.startsWith("Doação registada:")) continue;

                const match = msg.content.match(/\*\*(.+?) → (.+?) \((\d+)\)\*\*/);
                if (!match) continue;

                const donator = match[1];
                const receiver = match[2];
                const amount = parseInt(match[3]);

                const donatorId = await getUserId(donator);
                const receiverId = await getUserId(receiver);

                const donatorAvatar = await getAvatar(donatorId);
                const receiverAvatar = await getAvatar(receiverId);

                newDonations.push({
                    donator,
                    receiver,
                    amount,
                    donatorAvatar,
                    receiverAvatar,
                    timestamp: Date.now(),
                    messageId: msg.id
                });

                count++;
            }

            lastId = messages.last().id;
        }

        donations = newDonations.reverse();
        saveDonations();
        rebuildTotals();
        broadcastTopDonators();
        sendToSite({ type: "all", donations });

        console.log(`✅ Reconstrução concluída (${count} doações).`);
        return count;

    } catch (err) {
        console.log("❌ Erro ao reconstruir doações a partir do canal:", err);
        return 0;
    }
}

// --------------
// READY
// --------------
client.once("ready", async () => {
    console.log(`🤖 Bot ligado como ${client.user.tag}`);

    rebuildTotals();
    await rebuildFromChannel();

    await rest.put(
        Routes.applicationGuildCommands("1505911919645691974", "1327452211743293510"),
        { body: commands }
    );

    console.log("✅ Comandos registados.");
});

// --------------
// COMANDOS
// --------------
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "checkonline")
        return interaction.reply("I'm online!");

    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        const sent = await interaction.reply({
            content: `Doação registada: **${donator} → ${receiver} (${amount})**`,
            fetchReply: true
        });

        await sendDonation(null, donator, receiver, amount, sent.id);
    }

    if (interaction.commandName === "deletedono") {
        const messageId = interaction.options.getString("id");

        try {
            const msg = await interaction.channel.messages.fetch(messageId);
            await msg.delete();

            donations = donations.filter(d => d.messageId !== messageId);
            saveDonations();

            sendToSite({ type: "all", donations });

            rebuildTotals();
            broadcastTopDonators();

            return interaction.reply({ content: `🗑️ Doação apagada!`, ephemeral: true });

        } catch {
            return interaction.reply({ content: "❌ Não encontrei essa mensagem.", ephemeral: true });
        }
    }

    if (interaction.commandName === "rebuilddonos") {
        await interaction.reply({ content: "🔄 A reconstruir doações a partir do canal...", ephemeral: true });

        const count = await rebuildFromChannel();

        return interaction.editReply(
            count > 0
                ? `✅ Reconstrução concluída com **${count}** doações.`
                : "⚠️ Não encontrei doações para reconstruir."
        );
    }
});


// Mantém o Render a ver o serviço como ativo
const http = require("http");
const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running!");
});
server.listen(PORT, () => console.log(`🌐 HTTP server ativo na porta ${PORT}`));

// --------------
// LOGIN
// --------------
client.login(process.env.TOKEN);
