const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const WebSocket = require("ws");
const fetch = require("node-fetch");

// ---------------------------
// CONFIG
// ---------------------------
const DONATION_CHANNEL = "1506766663272628385"; // canal das doações

// ---------------------------
// WEBSOCKET SERVER
// ---------------------------
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// Quando o site se liga ao WebSocket
wss.on("connection", (ws) => {
    ws.on("message", async (msg) => {
        let data;

        try { data = JSON.parse(msg); }
        catch { return; }

        // Website pediu TODAS as doações
        if (data.type === "request_all") {
            const donations = await loadDonationsFromDiscord();
            ws.send(JSON.stringify({
                type: "all",
                donations
            }));
        }
    });
});

// ---------------------------
// FUNÇÃO: LER DOAÇÕES DO DISCORD
// ---------------------------
async function loadDonationsFromDiscord() {
    const channel = client.channels.cache.get(DONATION_CHANNEL);
    if (!channel) return [];

    let messages = [];
    let lastId;

    while (true) {
        const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
        if (fetched.size === 0) break;

        messages = messages.concat(Array.from(fetched.values()));
        lastId = fetched.last().id;
    }

    let donations = [];

    for (const msg of messages) {
        if (!msg.content.startsWith("Doação registada")) continue;

        const regex = /Doação registada(?: \(emergência\))?: \*\*(.+?) → (.+?) \((\d+)\)\*\*/;
        const match = msg.content.match(regex);
        if (!match) continue;

        const donator = match[1];
        const receiver = match[2];
        const amount = parseInt(match[3]);

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        donations.push({
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar
        });
    }

    // ordem: mais antigas → mais recentes
    return donations.reverse();
}

// ---------------------------
// ROBLOX API
// ---------------------------
async function getUserId(username) {
    try {
        const res = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username] })
        });

        const data = await res.json();
        return data.data[0]?.id;
    } catch {
        return null;
    }
}

async function getAvatar(userId) {
    if (!userId) return null;

    try {
        const res = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`
        );

        const data = await res.json();
        return data.data[0].imageUrl;
    } catch {
        return null;
    }
}

// ---------------------------
// DISCORD BOT
// ---------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ---------------------------
// REGISTAR COMANDOS SLASH
// ---------------------------
const commands = [
    new SlashCommandBuilder()
        .setName("dono")
        .setDescription("Regista uma doação")
        .addStringOption(option =>
            option.setName("donator")
                .setDescription("Nome do doador")
                .setRequired(true))
        .addStringOption(option =>
            option.setName("receiver")
                .setDescription("Nome do recebedor")
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName("amount")
                .setDescription("Valor da doação")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("deleteall")
        .setDescription("Apaga TODAS as mensagens de doação do canal")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
    console.log(`Bot ligado como ${client.user.tag}`);

    try {
        await rest.put(
            Routes.applicationGuildCommands("1506739143517016154", "1327452211743293510"),
            { body: commands }
        );
        console.log("Comandos registados!");
    } catch (error) {
        console.error(error);
    }
});

// ---------------------------
// COMANDOS SLASH + BOTÕES
// ---------------------------
client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // /dono
    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        await interaction.reply(
            `Doação registada: **${donator} → ${receiver} (${amount})**`
        );
    }

    // /deleteall
    if (interaction.commandName === "deleteall") {

        const channel = client.channels.cache.get(DONATION_CHANNEL);

        let lastId;
        while (true) {
            const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
            if (fetched.size === 0) break;

            lastId = fetched.last().id;

            for (const msg of fetched.values()) {
                if (msg.content.startsWith("Doação registada")) {
                    try { await msg.delete(); } catch {}
                }
            }
        }

        return interaction.reply("🗑️ Todas as doações foram apagadas do canal!");
    }
});

// ---------------------------
// LOGIN
// ---------------------------
client.login(process.env.TOKEN);
