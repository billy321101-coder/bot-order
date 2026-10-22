// bot.js — Discord Order Bot | Public Board + Role-gated Panel
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const fs = require('fs');
const http = require('http');

process.on('unhandledRejection', (err) =>
  console.error('❌ unhandled:', err)
);

process.on('uncaughtException', (err) =>
  console.error('❌ uncaught:', err)
);

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
}).listen(process.env.PORT || 3000, () => {
  console.log('✅ HTTP keep-alive running');
});



const DATA_FILE  = './data.json';
const PANEL_ROLE = '1556698699487387711'; // role ที่มีสิทธิ์ใช้ panel

// ─── persistence ──────────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE))
    return { boardMsgId: null, boardChannelId: null, orders: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!raw.orders && (raw.ordersDone || raw.ordersWip)) {
      const now = Math.floor(Date.now() / 1000);
      const orders = [];
      (raw.ordersWip  || []).forEach((name, i) => orders.push({
        id: `ORD-MIGRATED-WIP-${i}`, name, status: 'wip',
        userId: null, userTag: null,
        createdAt: now, wipAt: now, doneAt: null,
      }));
      (raw.ordersDone || []).forEach((name, i) => orders.push({
        id: `ORD-MIGRATED-DONE-${i}`, name, status: 'done',
        userId: null, userTag: null,
        createdAt: now, wipAt: null, doneAt: now,
      }));
      return { boardMsgId: raw.boardMsgId ?? null, boardChannelId: raw.boardChannelId ?? null, orders };
    }
    return raw;
  } catch {
    return { boardMsgId: null, boardChannelId: null, orders: [] };
  }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8'); }

let state = loadData();

// ─── helpers ──────────────────────────────────────────────────────
function tsNow() { return Math.floor(Date.now() / 1000); }

function hasRole(interaction) {
  return interaction.member?.roles?.cache?.has(PANEL_ROLE) ?? false;
}

// ─── embed builders ───────────────────────────────────────────────
function buildBoardEmbed() {
  const wip  = state.orders.filter(o => o.status === 'wip');
  const done = state.orders.filter(o => o.status === 'done');
  const DIV  = '─────────────────────────────';

  const wipLines = wip.length
    ? wip.map(o => {
        const user = o.userId ? ` — <@${o.userId}>` : '';
        const time = o.wipAt  ? ` | เริ่ม <t:${o.wipAt}:f>` : '';
        return `🟡 **${o.name}**${user}${time}`;
      }).join('\n')
    : '> *ไม่มีงานที่กำลังทำ*';

  const doneLines = done.length
    ? done.map(o => {
        const user = o.userId  ? ` — <@${o.userId}>` : '';
        const time = o.doneAt ? ` | เสร็จ <t:${o.doneAt}:f>` : '';
        return `🟢 **${o.name}**${user}${time}`;
      }).join('\n')
    : '> *ไม่มีงานที่เสร็จ*';

  const desc = [
    ``,
    `## ⚡ กำลังดำเนินการ  \`${wip.length}\``,
    DIV,
    wipLines,
    ``,
    `## ✅ เสร็จแล้ว  \`${done.length}\``,
    DIV,
    doneLines,
    ``,
    DIV,
    `📦 ทั้งหมด **${state.orders.length}** งาน  ·  ⚡ **${wip.length}**  ·  ✅ **${done.length}**`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Orders Status')
    .setDescription(desc)
    .setFooter({
      text: `Ddog Store — อัปเดตล่าสุด: ${new Date().toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short',
      })}`,
    });

  if (process.env.BANNER_URL)    embed.setImage(process.env.BANNER_URL);
  if (process.env.THUMBNAIL_URL) embed.setThumbnail(process.env.THUMBNAIL_URL);
  return embed;
}

function buildOrderEmbed(order) {
  const isWip = order.status === 'wip';
  const dot   = isWip ? '🟡' : '🟢';
  return new EmbedBuilder()
    .setColor(isWip ? 0xF5A623 : 0x2ECC71)
    .setTitle(`${dot} ${order.name}`)
    .setDescription([
      `${dot} **สถานะ:** ${isWip ? 'กำลังดำเนินการ' : 'เสร็จแล้ว'}`,
      `👤 **ลูกค้า:** ${order.userId ? `<@${order.userId}>` : '—'}`,
      `🕐 **เริ่มทำ:** ${order.wipAt  ? `<t:${order.wipAt}:F>`  : '—'}`,
      `🏁 **เสร็จเมื่อ:** ${order.doneAt ? `<t:${order.doneAt}:F>` : '—'}`,
      `\`${order.id}\``,
    ].join('\n'))
    .setTimestamp(order.createdAt ? order.createdAt * 1000 : Date.now());
}

// ─── panel row (ปุ่มควบคุม) ───────────────────────────────────────
function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_add')     .setLabel('➕ เพิ่มงาน') .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('btn_complete').setLabel('✅ เสร็จแล้ว').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('btn_remove')  .setLabel('🗑️ ลบงาน')   .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_clear')   .setLabel('🧹 ล้างบอร์ด').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_list')    .setLabel('📋 ดูรายการ') .setStyle(ButtonStyle.Secondary),
  );
}

// ─── sync board (ไม่มีปุ่ม — public) ─────────────────────────────
async function sendLog(order) {
  if (!process.env.LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    await ch.send({ embeds: [buildOrderEmbed(order)] });
  } catch (e) { console.error('log error:', e.message); }
}

async function syncBoard(channel) {
  // board ไม่มี components เลย — ทุกคนเห็นแค่ embed สะอาด
  const payload = { content: '', embeds: [buildBoardEmbed()], components: [] };
  if (state.boardMsgId) {
    try {
      const msg = await channel.messages.fetch(state.boardMsgId);
      await msg.edit(payload);
      return;
    } catch { /* gone */ }
  }
  const sent = await channel.send(payload);
  state.boardMsgId     = sent.id;
  state.boardChannelId = sent.channelId;
  saveData(state);
}

// ─── slash commands ────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('board_start')
    .setDescription('โพสบอร์ดสถานะในช่องนี้'),

  // /panel — เห็นได้ทุกคน แต่ใช้ได้เฉพาะ role (ตรวจสอบใน handler)
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('เปิดแผงควบคุมออเดอร์ (เฉพาะผู้ดูแล)'),

].map(c => c.toJSON());

// ─── client ────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });


client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Register commands failed:', err);
  }
});


const EPH = { flags: MessageFlags.Ephemeral };

// ─── interactions ──────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── /board_start ──────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'board_start') {
    await interaction.deferReply(EPH);
    await syncBoard(interaction.channel);
    return interaction.editReply('✅ บอร์ดโพสแล้ว');
  }

  // ── /panel — ส่ง ephemeral ปุ่มให้เฉพาะ role ─────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    if (!hasRole(interaction))
      return interaction.reply({ ...EPH, content: '❌ คุณไม่มีสิทธิ์ใช้งาน panel นี้' });

    return interaction.reply({
      ...EPH,
      content: '🛠️ **แผงควบคุมออเดอร์**',
      components: [buildPanelRow()],
    });
  }

  // ── guard ทุก button/select/modal — เฉพาะ role เท่านั้น ───────
  if (
    (interaction.isButton() ||
     interaction.isStringSelectMenu() ||
     interaction.isModalSubmit()) &&
    !hasRole(interaction)
  ) {
    return interaction.reply({ ...EPH, content: '❌ คุณไม่มีสิทธิ์ใช้งานปุ่มนี้' });
  }

  // ── ➕ เพิ่มงาน → Modal ────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_add') {
    const modal = new ModalBuilder().setCustomId('modal_add').setTitle('➕ เพิ่มงานใหม่');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('inp_name').setLabel('ชื่องาน')
          .setPlaceholder('เช่น ทำเผ่ามังกร V4 (@ลูกค้า)')
          .setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('inp_status').setLabel('สถานะ (wip หรือ done)')
          .setPlaceholder('wip = กำลังทำ | done = เสร็จแล้ว')
          .setStyle(TextInputStyle.Short).setValue('wip').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('inp_user').setLabel('User ID ลูกค้า (ไม่บังคับ)')
          .setPlaceholder('เช่น 123456789012345678')
          .setStyle(TextInputStyle.Short).setRequired(false)
      ),
    );
    return interaction.showModal(modal);
  }

  // ── Modal submit ───────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_add') {
    await interaction.deferReply(EPH);
    const name      = interaction.fields.getTextInputValue('inp_name').trim();
    const statusRaw = interaction.fields.getTextInputValue('inp_status').trim().toLowerCase();
    const userIdRaw = interaction.fields.getTextInputValue('inp_user').trim();
    const status    = statusRaw === 'done' ? 'done' : 'wip';
    const userId    = userIdRaw.match(/^\d{17,20}$/) ? userIdRaw : null;
    const now       = tsNow();
    const id        = `ORD-${now}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const order = {
      id, name, status, userId, userTag: null,
      createdAt: now,
      wipAt:  status === 'wip'  ? now : null,
      doneAt: status === 'done' ? now : null,
    };
    state.orders.push(order);
    saveData(state);

    if (state.boardChannelId) {
      const ch = await client.channels.fetch(state.boardChannelId);
      await sendLog(order);
      await syncBoard(ch);
    }
    return interaction.editReply(`✅ เพิ่มงาน **${name}** แล้ว\n\`${id}\``);
  }

  // ── ✅ เสร็จแล้ว → select wip ─────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_complete') {
    const wip = state.orders.filter(o => o.status === 'wip');
    if (!wip.length)
      return interaction.reply({ ...EPH, content: '⚠️ ไม่มีงานที่กำลังทำอยู่' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('sel_complete').setPlaceholder('เลือกงานที่เสร็จแล้ว')
      .addOptions(wip.slice(0, 25).map(o => ({
        label: o.name.slice(0, 100), description: o.id, value: o.id,
      })));

    return interaction.reply({
      ...EPH, content: '✅ เลือกงานที่ต้องการมาร์กว่าเสร็จ:',
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'sel_complete') {
    await interaction.deferUpdate();
    const order = state.orders.find(o => o.id === interaction.values[0]);
    if (!order) return interaction.editReply({ content: '❌ ไม่เจอออเดอร์', components: [] });
    order.status = 'done';
    order.doneAt = tsNow();
    saveData(state);
    if (state.boardChannelId) {
      const ch = await client.channels.fetch(state.boardChannelId);
      await sendLog(order);
      await syncBoard(ch);
    }
    return interaction.editReply({ content: `✅ **${order.name}** เสร็จแล้ว 🟢`, components: [] });
  }

  // ── 🗑️ ลบงาน ───────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_remove') {
    if (!state.orders.length)
      return interaction.reply({ ...EPH, content: '⚠️ ยังไม่มีออเดอร์' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('sel_remove').setPlaceholder('เลือกงานที่ต้องการลบ')
      .addOptions(state.orders.slice(0, 25).map(o => ({
        label: `${o.status === 'wip' ? '🟡' : '🟢'} ${o.name.slice(0, 90)}`,
        description: o.id, value: o.id,
      })));

    return interaction.reply({
      ...EPH, content: '🗑️ เลือกงานที่ต้องการลบ:',
      components: [new ActionRowBuilder().addComponents(menu)],
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'sel_remove') {
    await interaction.deferUpdate();
    const idx = state.orders.findIndex(o => o.id === interaction.values[0]);
    if (idx === -1) return interaction.editReply({ content: '❌ ไม่เจอออเดอร์', components: [] });
    const [removed] = state.orders.splice(idx, 1);
    saveData(state);
    if (state.boardChannelId) {
      const ch = await client.channels.fetch(state.boardChannelId);
      await syncBoard(ch);
    }
    return interaction.editReply({ content: `✅ ลบ **${removed.name}** ออกแล้ว`, components: [] });
  }

  // ── 🧹 ล้างบอร์ด → ยืนยันก่อน ────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_clear') {
    return interaction.reply({
      ...EPH, content: '⚠️ ยืนยันล้างงานทั้งหมดในบอร์ด?',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_clear_confirm').setLabel('ยืนยัน ล้างทั้งหมด').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_clear_cancel') .setLabel('ยกเลิก')             .setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  if (interaction.isButton() && interaction.customId === 'btn_clear_confirm') {
    await interaction.deferUpdate();
    state.orders = [];
    saveData(state);
    if (state.boardChannelId) {
      const ch = await client.channels.fetch(state.boardChannelId);
      await syncBoard(ch);
    }
    return interaction.editReply({ content: '✅ ล้างบอร์ดแล้ว', components: [] });
  }

  if (interaction.isButton() && interaction.customId === 'btn_clear_cancel') {
    return interaction.update({ content: '❌ ยกเลิกแล้ว', components: [] });
  }

  // ── 📋 ดูรายการ ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_list') {
    if (!state.orders.length)
      return interaction.reply({ ...EPH, content: '_ยังไม่มีออเดอร์_' });
    const lines = state.orders.map(o =>
      `${o.status === 'wip' ? '🟡' : '🟢'} \`${o.id}\` — **${o.name}**`
    ).join('\n');
    return interaction.reply({ ...EPH, content: `📋 **Order IDs ทั้งหมด:**\n${lines}` });
  }

});




console.log('🔄 กำลังเชื่อมต่อ Discord...');
console.log('TOKEN exists:', Boolean(process.env.TOKEN));
console.log('GUILD_ID exists:', Boolean(process.env.GUILD_ID));

client.login(process.env.TOKEN).catch((err) => {
  console.error('❌ Discord login failed:', err);
});

