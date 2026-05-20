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
    const res = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`
    );

    const data = await res.json();
    return data.data[0].imageUrl;
}


// ---------------------------
// DISCORD BOT
// ---------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// ---------------------------
// REGISTAR COMANDOS SLASH
// ---------------------------
const commands = [
    new SlashCommandBuilder()
        .setName('checkonline')
        .setDescription('Verifica se o bot está online!'),

    new SlashCommandBuilder()
        .setName('dono')
        .setDescription('Regista uma doação')
        .addStringOption(option =>
            option.setName('donator')
                .setDescription('Nome do doador')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('receiver')
                .setDescription('Nome do recebedor')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Valor da doação')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('deletedono')
        .setDescription('Apaga uma doação pelo ID da mensagem')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('ID da mensagem do bot')
                .setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

client.once("ready", async () => {
    console.log(`Bot ligado como ${client.user.tag}`);

    try {
        await rest.put(
            Routes.applicationGuildCommands("1505911919645691974", "1327452211743293510"),
            { body: commands }
        );
        console.log("Comandos registados!");
    } catch (error) {
        console.error(error);
    }
});

// ---------------------------
// COMANDOS
// ---------------------------
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // /checkonline
    if (interaction.commandName === "checkonline") {
        return interaction.reply("I'm online!");
    }

    // /dono
    if (interaction.commandName === "dono") {
        const donator = interaction.options.getString("donator");
        const receiver = interaction.options.getString("receiver");
        const amount = interaction.options.getInteger("amount");

        // enviar mensagem e guardar ID
        const sent = await interaction.reply({
            content: `Doação registada: **${donator} → ${receiver} (${amount})**`,
            fetchReply: true
        });

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        const donation = {
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar,
            messageId: sent.id
        };

        donations.unshift(donation);
        saveDonations();
        sendToSite(donation);
    }

    // /deletedono
    if (interaction.commandName === "deletedono") {
        const messageId = interaction.options.getString("id");

        try {
            const channel = interaction.channel;
            const msg = await channel.messages.fetch(messageId);
            await msg.delete();

            donations = donations.filter(d => d.messageId !== messageId);
            saveDonations();

            sendToSite({
                type: "all",
                donations
            });

            return interaction.reply({
                content: `🗑️ Doação apagada com sucesso! (ID: ${messageId})`,
                ephemeral: true
            });

        } catch (err) {
            console.log(err);
            return interaction.reply({
                content: "❌ Não encontrei essa mensagem ou não consegui apagar.",
                ephemeral: true
            });
        }
    }
});

// ---------------------------
// LOGIN
// ---------------------------
client.login(process.env.TOKEN);
