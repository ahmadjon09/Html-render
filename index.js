import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import express from 'express'
import { Telegraf, Markup } from 'telegraf'

/**
 *  — HTML Host Bot (logs + confirm delete + owner metadata + update support + keepAlive)
 *  .env required:
 *    BOT_TOKEN=...
 *    BASE_URL=http://yourdomain.com   (default http://localhost:3000)
 *    PORT=3000
 *
 *  Usage:
 *    npm i telegraf express
 *    node app.js
 */

// ENV
const {
  BOT_TOKEN,
  BASE_URL = 'http://localhost:3000',
  PORT = 3000
} = process.env
if (!BOT_TOKEN) throw new Error('BOT_TOKEN required!')

// Paths
const ROOT = process.cwd()
const SITES_DIR = path.join(ROOT, 'sites')
const META_FILE = path.join(SITES_DIR, 'sites.json')
const LOG_FILE = path.join(SITES_DIR, 'logs.txt')

fs.mkdirSync(SITES_DIR, { recursive: true })

// Simple logger (append)
const log = (level, userId, action, details = '') => {
  try {
    const time = new Date().toISOString()
    const line = `[${time}] [${level}] user:${userId} action:${action} ${details}\n`
    fs.appendFileSync(LOG_FILE, line, 'utf8')
    console.log(line.trim())
  } catch (err) {
    console.error('Log error:', err)
  }
}

// Load/save metadata
let SITES_META = {}
const loadMeta = () => {
  try {
    if (fs.existsSync(META_FILE)) {
      SITES_META = JSON.parse(fs.readFileSync(META_FILE, 'utf8') || '{}')
    } else {
      SITES_META = {}
    }
  } catch (err) {
    console.error('Meta load error', err)
    SITES_META = {}
  }
}
const saveMeta = () => {
  try {
    fs.writeFileSync(META_FILE, JSON.stringify(SITES_META, null, 2), 'utf8')
  } catch (err) {
    console.error('Meta save error', err)
  }
}
loadMeta()

// Helpers
const genId = () => Math.random().toString(36).substring(2, 8)

const addSiteMeta = (id, userId, sizeKB) => {
  const now = new Date().toISOString()
  SITES_META[id] = {
    id,
    owner: userId,
    file: `${id}.html`,
    sizeKB,
    createdAt: now,
    updatedAt: now
  }
  saveMeta()
}

const updateSiteMeta = (id, sizeKB) => {
  if (!SITES_META[id]) return
  SITES_META[id].sizeKB = sizeKB
  SITES_META[id].updatedAt = new Date().toISOString()
  saveMeta()
}

const removeSiteMeta = id => {
  if (SITES_META[id]) {
    delete SITES_META[id]
    saveMeta()
  }
}

const getUserSites = userId => {
  return Object.values(SITES_META).filter(s => s.owner === userId)
}

const generateQR = async (url, userId) => {
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      url
    )}`
    return qrUrl
  } catch (err) {
    console.error('QR generation error:', err)
    return null
  }
}

// Telegraf & Express
const app = express()
const bot = new Telegraf(BOT_TOKEN)

// In-memory maps to track "waiting for upload" states per user
const pendingUpload = new Map()
const pendingAction = new Map()

const L = {
  welcome: `🏠 <b>Welcome to HTML Host Bot!</b>\n\nSend HTML file → instant hosting`,
  file_only_html: '❌ Only .html files!',
  file_received: '📥 <b>File received!</b>\n\nCreating...',
  upload_new: '📤 Send new HTML file',
  my_sites: '📁 Your sites',
  no_sites: '📭 No sites yet.\n\nSend HTML file!',
  delete: '🗑 Delete',
  view: '👀 View',
  new_upload: '🆕 Upload new',
  back: '🔙 Back',
  help: `ℹ️ <b>HTML Host Bot Help</b>\n\n📤 <b>Upload HTML:</b>\n• Click "Upload new" or send .html file\n• File must contain valid HTML\n\n📁 <b>Manage Sites:</b>\n• Use /my command to list your sites\n• View, update, or delete existing sites\n• Get QR codes for easy sharing\n\n🔄 <b>Update Sites:</b>\n• Click "Update" on any site\n• Send new HTML file to replace content\n\n🗑 <b>Delete Sites:</b>\n• Confirmation required before deletion\n• Cannot be undone\n\n📊 <b>Limits:</b>\n• File size: Up to 20MB (Telegram limit)\n• File type: HTML only\n• No database storage - pure file hosting\n\n🔗 <b>Features:</b>\n• Instant hosting\n• QR code generation\n• Update existing sites\n• Owner-based access control\n• Activity logging`,
  error: '❌ Error saving file',
  success: '✅ <b>Successfully created!</b>',
  updated: '🔄 <b>Updated!</b>',
  deleted: '🗑 <b>Deleted!</b>',
  confirm_delete: '⚠️ Are you sure you want to delete this site?',
  update_prompt: '🔄 Update',
  not_your_site: '❌ This site does not belong to you',
  site_not_found: '❌ Site not found',
  cancel: '❌ Cancel',
  cancelled: '❎ Cancelled',
  qr_code: '📱 QR Code',
  file_too_large: '❌ File too large (max 20MB)',
  invalid_html:
    '❌ Invalid HTML file - must contain &lt;html&gt; or &lt;!DOCTYPE&gt;',
  upload_reminder: '❗ Click "Upload new" button or use /my command first.',
  processing_error: '❌ Error processing file'
}

const t = key => L[key] ?? key

// Utility to send or edit messages - FIXED to always edit existing message
const editOrReply = async (ctx, text, keyboard = null) => {
  const options = {
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }
  if (keyboard) options.reply_markup = keyboard.reply_markup

  try {
    // Always try to edit the existing message if it's a callback query
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        ctx.callbackQuery.message.message_id,
        undefined,
        text,
        options
      )
      return ctx.callbackQuery.message.message_id
    } else {
      // For new messages (like start command), send new message
      const message = await ctx.reply(text, options)
      return message.message_id
    }
  } catch (err) {
    console.error('Message edit error:', err)
    // If edit fails (message too old), send new message
    const message = await ctx.reply(text, options)
    return message.message_id
  }
}

// Enhanced file validation
const validateHTMLFile = (file, html) => {
  // Check file size (Telegram limit is 20MB for documents)
  if (file.file_size > 20 * 1024 * 1024) {
    return { valid: false, error: t('file_too_large') }
  }

  // Check file extension
  if (!file.file_name?.toLowerCase().endsWith('.html')) {
    return { valid: false, error: t('file_only_html') }
  }

  // Check HTML content
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
    return { valid: false, error: t('invalid_html') }
  }

  return { valid: true }
}

/* ===== Bot handlers ===== */

bot.start(async ctx => {
  const userId = ctx.from.id
  log('INFO', userId, 'start', '')
  await editOrReply(
    ctx,
    t('welcome'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t('my_sites'), 'my_sites')],
      [Markup.button.callback('ℹ️ Help', 'help_btn')],
      [Markup.button.callback(t('new_upload'), 'upload')]
    ])
  )
})

bot.command('my', ctx => showSites(ctx))
bot.action('my_sites', ctx => showSites(ctx))

async function showSites (ctx) {
  const userId = ctx.from.id
  loadMeta()
  const sites = getUserSites(userId)
  log('INFO', userId, 'list_sites', `count=${sites.length}`)

  if (!sites.length) {
    return editOrReply(
      ctx,
      t('no_sites'),
      Markup.inlineKeyboard([
        [Markup.button.callback(t('new_upload'), 'upload')],
        [Markup.button.callback(t('back'), 'back_start')]
      ])
    )
  }

  let text = `<b>${t('my_sites')}</b>\n\n`
  const keyboard = []
  sites.forEach((site, index) => {
    const updated = new Date(site.updatedAt).toLocaleDateString()
    text += `${index + 1}. <code>${site.id}</code> — ${
      site.sizeKB
    } KB — <i>${updated}</i>\n`
    keyboard.push([
      Markup.button.url(t('view'), `${BASE_URL}/sites/${site.file}`),
      Markup.button.callback(t('qr_code'), `qr_${site.id}`),
      Markup.button.callback(t('update_prompt'), `update_select_${site.id}`),
      Markup.button.callback(t('delete'), `del_select_${site.id}`)
    ])
  })

  keyboard.push([
    Markup.button.callback(t('new_upload'), 'upload'),
    Markup.button.callback('ℹ️ Help', 'help_btn'),
    Markup.button.callback(t('back'), 'back_start')
  ])

  await editOrReply(ctx, text, Markup.inlineKeyboard(keyboard))
}

bot.action(/qr_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]

  if (!meta) {
    await ctx.answerCbQuery(t('site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t('not_your_site'), { show_alert: true })
    return
  }

  const url = `${BASE_URL}/sites/${meta.file}`
  const qrUrl = await generateQR(url, userId)

  await ctx.answerCbQuery()

  if (qrUrl) {
    // For QR code, we send a new message since it's a photo
    await ctx.replyWithPhoto(qrUrl, {
      caption: `📱 <b>QR Code</b>\n\n<code>${id}</code>\n\n🔗 <a href="${url}">Open Site</a>`,
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(t('back'), 'my_sites')]
      ])
    })
  } else {
    await editOrReply(
      ctx,
      t('error'),
      Markup.inlineKeyboard([[Markup.button.callback(t('back'), 'my_sites')]])
    )
  }
})

bot.action('back_start', async ctx => {
  await ctx.answerCbQuery()
  await editOrReply(
    ctx,
    t('welcome'),
    Markup.inlineKeyboard([
      [Markup.button.callback(t('my_sites'), 'my_sites')],
      [Markup.button.callback('ℹ️ Help', 'help_btn')],
      [Markup.button.callback(t('new_upload'), 'upload')]
    ])
  )
})

// Upload prompt
bot.action('upload', async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  pendingUpload.set(userId, { type: 'create' })
  log('INFO', userId, 'awaiting_upload', 'create')
  await editOrReply(
    ctx,
    `<b>${t('upload_new')}</b>\n\n<i>${t('file_only_html')}</i>`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t('back'), 'my_sites')],
      [Markup.button.callback('ℹ️ Help', 'help_btn')]
    ])
  )
})

bot.action(/del_select_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]

  if (!meta) {
    await ctx.answerCbQuery(t('site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t('not_your_site'), { show_alert: true })
    return
  }

  pendingAction.set(userId, { type: 'delete', id })
  await ctx.answerCbQuery()

  await editOrReply(
    ctx,
    `${t(
      'confirm_delete'
    )}\n\n<code>${id}</code>\n\n📍 <b>URL:</b> ${BASE_URL}/sites/${meta.file}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes', `del_confirm_${id}`),
        Markup.button.callback(t('cancel'), `del_cancel_${id}`)
      ]
    ])
  )
})

bot.action(/update_select_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]

  if (!meta) {
    await ctx.answerCbQuery(t('site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t('not_your_site'), { show_alert: true })
    return
  }

  pendingUpload.set(userId, { type: 'update', id })
  pendingAction.set(userId, { type: 'update', id })
  await ctx.answerCbQuery()

  await editOrReply(
    ctx,
    `<b>${t('update_prompt')}: <code>${id}</code></b>\n\n<i>${t(
      'file_only_html'
    )}</i>`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t('back'), 'my_sites')],
      [Markup.button.callback('ℹ️ Help', 'help_btn')]
    ])
  )
})

// Document handler (uploads)
bot.on('document', async ctx => {
  const userId = ctx.from.id

  const pending = pendingUpload.get(userId)
  if (!pending) {
    // if user didn't request upload, remind them - edit current message
    return editOrReply(
      ctx,
      `<b>${t('upload_reminder')}</b>`,
      Markup.inlineKeyboard([
        [Markup.button.callback(t('new_upload'), 'upload')],
        [Markup.button.callback('ℹ️ Help', 'help_btn')]
      ])
    )
  }

  const file = ctx.message.document

  // Edit current message to show loading
  await editOrReply(
    ctx,
    `<b>${t('file_received')}</b>`,
    Markup.inlineKeyboard([]) // Remove buttons during processing
  )

  try {
    const fileInfo = await ctx.telegram.getFile(file.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`

    const response = await fetch(fileUrl)
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`)
    }

    const html = await response.text()

    // Validate file
    const validation = validateHTMLFile(file, html)
    if (!validation.valid) {
      await editOrReply(
        ctx,
        `<b>${validation.error}</b>`,
        Markup.inlineKeyboard([[Markup.button.callback(t('back'), 'my_sites')]])
      )
      log(
        'WARN',
        userId,
        'upload_failed_validation',
        `fileName=${file.file_name} reason=${validation.error}`
      )
      pendingUpload.delete(userId)
      return
    }

    if (pending.type === 'create') {
      const id = genId()
      const filepath = path.join(SITES_DIR, `${id}.html`)
      fs.writeFileSync(filepath, html, 'utf8')
      const size = (html.length / 1024).toFixed(2)
      addSiteMeta(id, userId, size)
      const url = `${BASE_URL}/sites/${id}.html`
      const qrUrl = await generateQR(url, userId)

      const resultText =
        `✅ <b>${t('success')}</b>\n\n` +
        `📝 <b>ID:</b> <code>${id}</code>\n` +
        `📦 <b>Size:</b> ${size} KB\n` +
        `🔗 <b>URL:</b> <a href="${url}">${url}</a>`

      const keyboard = [
        [Markup.button.url(t('view'), url)],
        [
          Markup.button.callback(t('my_sites'), 'my_sites'),
          Markup.button.callback(t('new_upload'), 'upload')
        ]
      ]

      if (qrUrl) {
        // For QR code, send new message with photo
        await ctx.replyWithPhoto(qrUrl, {
          caption: resultText,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        })
      } else {
        await editOrReply(ctx, resultText, Markup.inlineKeyboard(keyboard))
      }

      log('INFO', userId, 'create_site', `id=${id} sizeKB=${size}`)
      pendingUpload.delete(userId)
    } else if (pending.type === 'update') {
      const id = pending.id
      const meta = SITES_META[id]
      if (!meta) {
        await editOrReply(ctx, t('site_not_found'), Markup.inlineKeyboard([]))
        log('WARN', userId, 'update_failed_not_found', `id=${id}`)
        pendingUpload.delete(userId)
        return
      }
      if (meta.owner !== userId) {
        await editOrReply(ctx, t('not_your_site'), Markup.inlineKeyboard([]))
        log('WARN', userId, 'update_failed_not_owner', `id=${id}`)
        pendingUpload.delete(userId)
        return
      }

      const filepath = path.join(SITES_DIR, `${id}.html`)
      fs.writeFileSync(filepath, html, 'utf8')
      const size = (html.length / 1024).toFixed(2)
      updateSiteMeta(id, size)
      const url = `${BASE_URL}/sites/${id}.html`
      const qrUrl = await generateQR(url, userId)

      const resultText =
        `🔄 <b>${t('updated')}</b>\n\n` +
        `📝 <b>ID:</b> <code>${id}</code>\n` +
        `📦 <b>New Size:</b> ${size} KB\n` +
        `🔗 <b>URL:</b> <a href="${url}">${url}</a>`

      const keyboard = [
        [Markup.button.url(t('view'), url)],
        [Markup.button.callback(t('my_sites'), 'my_sites')]
      ]

      if (qrUrl) {
        await ctx.replyWithPhoto(qrUrl, {
          caption: resultText,
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(keyboard)
        })
      } else {
        await editOrReply(ctx, resultText, Markup.inlineKeyboard(keyboard))
      }

      log('INFO', userId, 'update_site', `id=${id} sizeKB=${size}`)
      pendingUpload.delete(userId)
    }
  } catch (err) {
    console.error('File processing error:', err)
    await editOrReply(
      ctx,
      `<b>${t('processing_error')}</b>\n\n<code>${err.message}</code>`,
      Markup.inlineKeyboard([[Markup.button.callback(t('back'), 'my_sites')]])
    )
    log('ERROR', userId, 'upload_error', err.message)
    pendingUpload.delete(userId)
  }
})

// Confirm delete
bot.action(/del_confirm_(.+)/, async ctx => {
  const id = ctx.match[1]
  const userId = ctx.from.id
  const meta = SITES_META[id]
  if (!meta) {
    await ctx.answerCbQuery(t('site_not_found'), { show_alert: true })
    return
  }
  if (meta.owner !== userId) {
    await ctx.answerCbQuery(t('not_your_site'), { show_alert: true })
    return
  }

  const file = path.join(SITES_DIR, `${id}.html`)
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    removeSiteMeta(id)
    await ctx.answerCbQuery(t('deleted'))
    await editOrReply(
      ctx,
      `🗑 <b>${t('deleted')}</b>\n\nID: <code>${id}</code>`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t('my_sites'), 'my_sites'),
          Markup.button.callback(t('back'), 'back_start')
        ]
      ])
    )
    log('INFO', userId, 'delete_site', `id=${id}`)
    pendingAction.delete(userId)
  } catch (err) {
    console.error('Delete error', err)
    await ctx.answerCbQuery(t('error'), { show_alert: true })
    log('ERROR', userId, 'delete_error', `${id} ${err.message}`)
  }
})

// Cancel delete
bot.action(/del_cancel_(.+)/, async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  await editOrReply(
    ctx,
    t('cancelled'),
    Markup.inlineKeyboard([[Markup.button.callback(t('my_sites'), 'my_sites')]])
  )
  log('INFO', userId, 'delete_cancel', `id=${ctx.match[1]}`)
  pendingAction.delete(userId)
})

// Enhanced Help command
bot.help(async ctx => {
  const userId = ctx.from.id
  await editOrReply(
    ctx,
    t('help'),
    Markup.inlineKeyboard([
      [
        Markup.button.callback(t('my_sites'), 'my_sites'),
        Markup.button.callback(t('new_upload'), 'upload')
      ],
      [Markup.button.callback(t('back'), 'back_start')]
    ])
  )
  log('INFO', userId, 'help')
})

bot.action('help_btn', async ctx => {
  await ctx.answerCbQuery()
  const userId = ctx.from.id
  await editOrReply(
    ctx,
    t('help'),
    Markup.inlineKeyboard([
      [
        Markup.button.callback(t('my_sites'), 'my_sites'),
        Markup.button.callback(t('new_upload'), 'upload')
      ],
      [Markup.button.callback(t('back'), 'back_start')]
    ])
  )
  log('INFO', userId, 'help_from_button')
})

// Keep Alive function for Render.com
const keepAlive = () => {
  if (BASE_URL.includes('render.com') || BASE_URL.includes('localhost')) {
    const url = BASE_URL.startsWith('http') ? BASE_URL : `https://${BASE_URL}`
    console.log(`🔄 Keep-alive ping: ${url}`)
    fetch(url).catch(err => console.log('Keep-alive ping failed:', err.message))
  }
}

// Launch bot & server
bot.launch().then(() => {
  console.log('✅ Bot is running!')
  log('INFO', 'server', 'bot_launch', `BASE_URL=${BASE_URL}`)
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

app.use('/sites', express.static(SITES_DIR))
app.get('/', (_, res) =>
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>HTML Host Bot</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
      .header { text-align: center; margin-bottom: 30px; }
      .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
      .feature { background: #f5f5f5; padding: 20px; border-radius: 8px; }
      .bot-link { display: inline-block; background: #0088cc; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; margin: 10px 0; }
    </style>
  </head>
  <body>
    <div class="header">
      <h1>🏠 HTML Host Bot</h1>
      <p>Instant HTML file hosting via Telegram bot</p>
      <a href="https://t.me/${bot.botInfo.username}" class="bot-link">Start Using the Bot</a>
    </div>
    
    <div class="features">
      <div class="feature">
        <h3>📤 Easy Upload</h3>
        <p>Send HTML files directly to the bot for instant hosting</p>
      </div>
      <div class="feature">
        <h3>📱 QR Codes</h3>
        <p>Generate QR codes for easy mobile sharing</p>
      </div>
      <div class="feature">
        <h3>🔄 Update Any Time</h3>
        <p>Update your hosted HTML files anytime</p>
      </div>
      <div class="feature">
        <h3>🔒 Secure</h3>
        <p>Only you can manage your uploaded files</p>
      </div>
    </div>
    
    <h2>How to Use</h2>
    <ol>
      <li>Start the bot and click "Upload new"</li>
      <li>Send your HTML file (max 20MB)</li>
      <li>Get instant hosting URL and QR code</li>
      <li>Manage your sites with /my command</li>
    </ol>
    
    <h2>Features</h2>
    <ul>
      <li>Instant file hosting</li>
      <li>QR code generation</li>
      <li>Update existing sites</li>
      <li>Delete with confirmation</li>
      <li>File size and type validation</li>
      <li>Activity logging</li>
    </ul>
  </body>
  </html>
`)
)

const keepServerAlive = () => {
  if (BASE_URL.includes('render.com')) {
    setInterval(() => {
      fetch(BASE_URL)
        .then(() => console.log('🔄 Server active'))
        .catch(err => console.log('⚠️ Ping failed:', err.message))
    }, 10 * 60 * 1000)
  }
}

keepServerAlive()

app.listen(PORT, () => {
  console.log(`🚀 Server: ${BASE_URL}`)
  console.log(`📁 Sites directory: ${SITES_DIR}`)
  log('INFO', 'server', 'express_listen', `PORT=${PORT}`)
})
