// ================== IMPORTS ==================

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials, REST, Routes } = require("discord.js");
const WebSocket = require("ws");

// Node 18+ já tem fetch nativo
// ================== CONFIG ==================

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const DONATIONS_CHANNEL_ID = process.env.DONATIONS_CHANNEL_ID;
const WS_PORT = process.env.WS_PORT || 3001;

const DONATIONS_FILE = path.join(__dirname, "donations.json");

// ================== ESTADO ==================

let donations = [];
let wsClients = [];

// ================== FICHEIRO ==================

function loadDonations() {
    try {
        if (fs.existsSync(DONATIONS_FILE)) {
            donations = JSON.parse(fs.readFileSync(DONATIONS_FILE, "utf8"));
            console.log(`📂 Doações carregadas (${donations.length}).`);
        } else {
            donations = [];
            console.log("📂 Sem ficheiro de doações, a começar vazio.");
        }
    } catch (err) {
        console.log("❌ Erro a carregar donations.json:", err);
        donations = [];
    }
}

function saveDonations() {
    try {
        fs.writeFileSync(DONATIONS_FILE, JSON.stringify(donations, null, 2), "utf8");
        console.log("💾 Doações guardadas.");
    } catch (err) {
        console.log("❌ Erro a guardar donations.json:", err);
    }
}

// ================== ROBLOX HELPERS ==================

async function getUserId(username) {
    username = username.trim();

    try {
        // API nova
        const res = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username] })
        });

        const data = await res.json();
        const id = data?.data?.[0]?.id;
        if (id) return id;

        // API antiga
        const fallback = await fetch(
            `https://api.roblox.com/users/get-by-username?username=${encodeURIComponent(username)}`
        );
        const oldData = await fallback.json();
        if (oldData && oldData.Id) return oldData.Id;

        return null;
    } catch {
        return null;
    }
}

async function getAvatar(userId) {
    if (!userId) return "Template.png";
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;
}

// ================== WEBSOCKET PARA O SITE ==================

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`🌐 WebSocket ativo na porta ${WS_PORT}`);
});

wss.on("connection", (ws) => {
    wsClients.push(ws);
    ws.send(JSON.stringify({ type: "all", donations }));

    ws.on("close", () => {
        wsClients = wsClients.filter(c => c !== ws);
    });
});

function sendToSite(payload) {
    const data = JSON.stringify(payload);
    wsClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
}

// ================== TOP DONATORS ==================

function broadcastTopDonators() {
    const totals = new Map();

    for (const d of donations) {
        const key = d.donator.toLowerCase();
        totals.set(key, (totals.get(key) || 0) + d.amount);
    }

    const top = [...totals.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

    sendToSite({ type: "topDonators", data: top });
}

// ================== DISCORD CLIENT ==================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

// ================== SLASH COMMANDS ==================

const commands = [
    {
        name: "dono",
        description: "Registar uma doação",
        options: [
            { name: "donator", type: 3, description: "Quem doou", required: true },
            { name: "receiver", type: 3, description: "Quem recebeu", required: true },
            { name: "amount", type: 4, description: "Valor", required: true }
        ]
    },
    {
        name: "deletedono",
        description: "Apagar uma doação",
        options: [
            { name: "id", type: 3, description: "ID da mensagem", required: true }
        ]
    },
    {
        name: "alldonodelete",
        description: "Apagar TODAS as doações"
    }
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
    await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commands }
    );
    console.log("✅ Slash commands registados.");
}

// ================== EVENTOS ==================

client.once("ready", async () => {
    console.log(`🤖 Logado como ${client.user.tag}`);
    loadDonations();
    await registerCommands();
    broadcastTopDonators();
});

// ================== HANDLER DE MENSAGENS (PREFIXO) ==================

client.on("messageCreate", async (msg) => {
    if (!msg.content.startsWith("?dono")) return;

    const lines = msg.content.split("\n");

    for (const line of lines) {
        if (!line.startsWith("?dono")) continue;

        const parts = line.split(" ");

        if (parts.length < 4) continue;

        const donator = parts[1];
        const receiver = parts[2];
        const amount = parseInt(parts[3]);

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        const channel = await client.channels.fetch(DONATIONS_CHANNEL_ID);

        const discordMsg = await channel.send(
            `Doação registada: **${donator} → ${receiver} (${amount})**`
        );

        const donation = {
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar,
            timestamp: Date.now(),
            messageId: discordMsg.id
        };

        donations.unshift(donation);
    }

    saveDonations();
    broadcastTopDonators();
    sendToSite({ type: "all", donations });

    msg.reply("✅ Doações adicionadas com sucesso.");
});

// ================== HANDLER DE SLASH COMMANDS ==================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // ------------------ /dono ------------------
    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        const channel = await client.channels.fetch(DONATIONS_CHANNEL_ID);

        const msg = await channel.send(
            `Doação registada: **${donator} → ${receiver} (${amount})**`
        );

        const donation = {
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar,
            timestamp: Date.now(),
            messageId: msg.id
        };

        donations.unshift(donation);
        saveDonations();
        broadcastTopDonators();
        sendToSite({ type: "single", ...donation });

        await interaction.reply({ content: "✅ Doação registada.", ephemeral: true });
    }

    // ------------------ /deletedono ------------------
    if (interaction.commandName === "deletedono") {
        const messageId = interaction.options.getString("id");

        try {
            const channel = await client.channels.fetch(DONATIONS_CHANNEL_ID);
            const msg = await channel.messages.fetch(messageId);
            await msg.delete();
        } catch {}

        const before = donations.length;
        donations = donations.filter(d => d.messageId !== messageId);
        saveDonations();
        broadcastTopDonators();
        sendToSite({ type: "all", donations });

        if (donations.length < before) {
            await interaction.reply({ content: "🗑️ Doação apagada.", ephemeral: true });
        } else {
            await interaction.reply({ content: "❌ ID não encontrado.", ephemeral: true });
        }
    }

    // ------------------ /alldonodelete ------------------
    if (interaction.commandName === "alldonodelete") {
        donations = [];
        saveDonations();
        broadcastTopDonators();
        sendToSite({ type: "all", donations });

        await interaction.reply({ content: "🗑️ Todas as doações foram apagadas.", ephemeral: true });
    }
});

// ================== LOGIN ==================

client.login(TOKEN);
