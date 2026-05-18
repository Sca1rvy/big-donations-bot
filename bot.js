const { Client, GatewayIntentBits } = require("discord.js");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const fs = require("fs");

// ---------------------------
// WEBSOCKET SERVER
// ---------------------------
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });


// Lista de doações guardadas
let donations = [];

// Carregar doações guardadas do ficheiro
if (fs.existsSync("donations.json")) {
    donations = JSON.parse(fs.readFileSync("donations.json"));
}

// Guardar doações no ficheiro
function saveDonations() {
    fs.writeFileSync("donations.json", JSON.stringify(donations, null, 2));
}

// Quando o site se liga ao WebSocket
wss.on("connection", (ws) => {
    // Enviar TODAS as doações guardadas
    ws.send(JSON.stringify({
        type: "all",
        donations
    }));
});

// Enviar doação nova para o site
function sendToSite(data) {
    const json = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
}

// ---------------------------
// ROBLOX API
// ---------------------------
async function getUserId(username) {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username] })
    });

    const data = await res.json();
    return data.data[0]?.id;
}

async function getAvatar(userId) {
    return `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;
}

// ---------------------------
// DISCORD BOT
// ---------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Bot ligado como ${client.user.tag}`);
});

// ---------------------------
// COMANDO /dono
// ---------------------------
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        await interaction.reply(`Doação registada: **${donator} → ${receiver} (${amount})**`);

        // Buscar info do Roblox
        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        // Criar objeto da doação
        const donation = {
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar
        };

        // Guardar no array
        donations.unshift(donation);

        // Guardar no ficheiro
        saveDonations();

        // Enviar para o site
        sendToSite(donation);
    }
});

// ---------------------------
// LOGIN
// ---------------------------
client.login(process.env.TOKEN);
