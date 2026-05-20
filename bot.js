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
    if (!userId) return null;

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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ---------------------------
// REGISTAR COMANDOS SLASH
// ---------------------------
const commands = [
    new SlashCommandBuilder()
        .setName("checkonline")
        .setDescription("Verifica se o bot está online!"),

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
        .setName("deletedono")
        .setDescription("Apaga uma doação pelo ID da mensagem")
        .addStringOption(option =>
            option.setName("id")
                .setDescription("ID da mensagem do bot")
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName("deleteall")
        .setDescription("Apaga TODAS as doações (confirmação necessária)"),

    new SlashCommandBuilder()
        .setName("exportdonos")
        .setDescription("Exporta todas as doações do canal para comandos ?dono")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

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
// COMANDOS SLASH + BOTÕES
// ---------------------------
client.on("interactionCreate", async interaction => {

    // BOTÕES DO /deleteall
    if (interaction.isButton()) {

    if (interaction.customId === "confirm_deleteall") {

        // 1) APAGAR TODAS AS DOAÇÕES DO FICHEIRO
        donations = [];
        saveDonations();

        // 2) APAGAR TODAS AS MENSAGENS "Doação registada" DO CANAL
        const channel = interaction.channel;

        let lastId;
        while (true) {
            const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
            if (fetched.size === 0) break;

            lastId = fetched.last().id;

            for (const msg of fetched.values()) {
                if (msg.content.startsWith("Doação registada")) {
                    try { await msg.delete(); } catch (err) {}
                }
            }
        }

        // 3) ATUALIZAR SITE
        sendToSite({
            type: "all",
            donations
        });

        // 4) RESPOSTA
        return interaction.update({
            content: "🗑️ Todas as doações e mensagens foram apagadas com sucesso!",
            components: []
        });
    }

    if (interaction.customId === "cancel_deleteall") {
        return interaction.update({
            content: "❌ Ação cancelada.",
            components: []
        });
    }

    return;
}


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
            messageId: sent.id,
            timestamp: Date.now()
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

    // /deleteall (SEM PERMISSÕES)
    if (interaction.commandName === "deleteall") {

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("confirm_deleteall")
                .setLabel("Sim")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("cancel_deleteall")
                .setLabel("Não")
                .setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({
            content: "⚠️ Tens a certeza que queres **apagar TODAS as doações**?",
            components: [row],
            ephemeral: true
        });
    }

    // /exportdonos (CORRIGIDO)
    if (interaction.commandName === "exportdonos") {

        await interaction.reply({ content: "📥 A ler mensagens do canal...", ephemeral: true });

        const channel = interaction.channel;
        let messages = [];
        let lastId;

        // buscar TODAS as mensagens do canal
        while (true) {
            const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
            if (fetched.size === 0) break;

            messages = messages.concat(Array.from(fetched.values()));
            lastId = fetched.last().id;
        }

        // ⭐ ORDENAR POR DATA (primeiras doações primeiro)
        messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let comandos = [];

        for (const msg of messages) {
            const content = msg.content;

            if (!content.startsWith("Doação registada")) continue;

            const regex = /Doação registada(?: \(emergência\))?: \*\*(.+?) → (.+?) \((\d+)\)\*\*/;
            const match = content.match(regex);

            if (!match) continue;

            const donator = match[1];
            const receiver = match[2];
            const amount = match[3];

            comandos.push(`?dono ${donator} ${receiver} ${amount}`);
        }

        if (comandos.length === 0) {
            return interaction.editReply("❌ Não encontrei nenhuma doação no canal.");
        }

        const fileContent = comandos.join("\n");
        fs.writeFileSync("exported_donos.txt", fileContent);

        return interaction.followUp({
            content: `✅ Foram encontrados **${comandos.length}** comandos.`,
            files: ["exported_donos.txt"],
            ephemeral: true
        });
    }
});

// ---------------------------
// COMANDO DE EMERGÊNCIA ?dono
// ---------------------------
client.on("messageCreate", async (msg) => {
    if (!msg.content.startsWith("?dono")) return;

    const lines = msg.content.split("\n");

    for (const line of lines) {
        if (!line.startsWith("?dono")) continue;

        const parts = line.trim().split(" ");

        if (parts.length < 4) continue;

        const donator = parts[1];
        const receiver = parts[2];
        const amount = parseInt(parts[3]);

        const donatorId = await getUserId(donator);
        const receiverId = await getUserId(receiver);

        const donatorAvatar = await getAvatar(donatorId);
        const receiverAvatar = await getAvatar(receiverId);

        const sent = await msg.channel.send(
            `Doação registada (emergência): **${donator} → ${receiver} (${amount})**`
        );

        const donation = {
            donator,
            receiver,
            amount,
            donatorAvatar,
            receiverAvatar,
            messageId: sent.id,
            timestamp: Date.now()
        };

        donations.unshift(donation);
    }

    saveDonations();

    sendToSite({
        type: "all",
        donations
    });

    msg.reply("✅ Doações de emergência adicionadas com sucesso!");
});

// ---------------------------
// LOGIN
// ---------------------------
client.login(process.env.TOKEN);
