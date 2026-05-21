// ---------------------------
// IMPORTS
// ---------------------------
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const WebSocket = require("ws");
const fetch = require("node-fetch");
const mongoose = require("mongoose");

// ---------------------------
// CONFIG
// ---------------------------
const DONATION_CHANNEL = "1506766663272628385"; // já não é usado para guardar, só para /deleteall
const PORT = process.env.PORT || 8080;

// ---------------------------
// MONGODB SCHEMA
// ---------------------------
const donationSchema = new mongoose.Schema({
    donator: String,
    receiver: String,
    amount: Number,
    donatorAvatar: String,
    receiverAvatar: String,
    timestamp: { type: Date, default: Date.now }
});

const Donation = mongoose.model("Donation", donationSchema);

// ---------------------------
// WEBSOCKET SERVER
// ---------------------------
const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
    ws.on("message", async (msg) => {
        let data;

        try { data = JSON.parse(msg); }
        catch { return; }

        // Website pediu TODAS as doações
        if (data.type === "request_all") {
            const donations = await Donation.find().sort({ timestamp: 1 });
            ws.send(JSON.stringify({
                type: "all",
                donations
            }));
        }
    });
});

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
// REGISTAR COMANDOS
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
        .setDescription("Apaga TODAS as doações do MongoDB")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ---------------------------
// READY
// ---------------------------
client.once("ready", async () => {
    console.log(`Bot ligado como ${client.user.tag}`);

    // LIGAR AO MONGODB
    await mongoose.connect(process.env.MONGO_URL);
    console.log("📦 MongoDB ligado!");

    // REGISTAR COMANDOS
    try {
        await rest.put(
            Routes.applicationGuildCommands("1506739143517016154", "1505911919645691974"),
            { body: commands }
        );
        console.log("Comandos registados!");
    } catch (error) {
        console.error(error);
    }
});

// ---------------------------
// COMANDOS SLASH
// ---------------------------
client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // /dono
    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        await Donation.create({
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar
        });

        await interaction.reply(
            `Doação registada: **${donator} → ${receiver} (${amount})**`
        );
    }

    // /deleteall
    if (interaction.commandName === "deleteall") {
        await Donation.deleteMany({});
        return interaction.reply("🗑️ Todas as doações foram apagadas da base de dados!");
    }
});

// ---------------------------
// LOGIN
// ---------------------------
client.login(process.env.TOKEN);
