const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function downloadBuffer(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(downloadBuffer(nextUrl, timeoutMs));
        } catch {
          return resolve(downloadBuffer(res.headers.location, timeoutMs));
        }
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}. Status code: ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => reject(err));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speechify')
    .setDescription('Adds a speech bubble to an image')
    .setIntegrationTypes([0, 1])
    .setContexts([0, 1, 2])
    .addAttachmentOption((option) =>
      option.setName('image').setDescription('Image to edit (PNG/JPEG). GIFs are not supported)').setRequired(true)
    )
    .addBooleanOption((option) => option.setName('alpha').setDescription('Use the alpha speech bubble (transparent interior)'))
    .addBooleanOption((option) => option.setName('flip').setDescription('Flip speech bubble horizontally'))
    .addBooleanOption((option) => option.setName('bottom').setDescription('Place bubble at bottom of image'))
    .addNumberOption((option) =>
      option
        .setName('scale')
        .setDescription('Fraction of image height the bubble should occupy (default 0.2)')
        .setMinValue(0.01)
        .setMaxValue(1.0)
    ),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('image');
    if (!attachment) return interaction.reply({ content: 'You must provide an image attachment.', flags: MessageFlags.Ephemeral });

    let sharp;
    try {
      sharp = require('sharp');
    } catch (err) {
      return interaction.reply({
        content: 'This command requires "sharp" to be installed in the bot environment. Run:\n\nnpm install sharp\n\nthen restart the bot and try again.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const parsedScale = interaction.options.getNumber('scale');
    const scale = parsedScale != null && !Number.isNaN(parsedScale) ? parsedScale : 0.2;
    const alpha = interaction.options.getBoolean('alpha') ?? false;
    const flip = interaction.options.getBoolean('flip') ?? false;
    const bottom = interaction.options.getBoolean('bottom') ?? false;

    const filename = alpha ? 'speech.png' : 'speechbubble.png';
    const overlayPath = path.resolve(process.cwd(), 'Data', 'Images', filename);
    if (!fs.existsSync(overlayPath)) {
      return interaction.reply({
        content: `Overlay image not found at path: ${overlayPath}\nPlease ensure Data/Images/${filename} exists.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    let baseBuffer;
    try {
      baseBuffer = await downloadBuffer(attachment.url, 15000);
    } catch (err) {
      console.error('speechify: download failed', err);
      return interaction.editReply({ content: `Failed to download the provided image: ${err.message}` });
    }

    let overlayBuffer;
    try {
      overlayBuffer = fs.readFileSync(overlayPath);
    } catch (err) {
      console.error('speechify: overlay read failed', err);
      return interaction.editReply({ content: `Failed to read overlay image: ${err.message}` });
    }

    try {
      const meta = await sharp(baseBuffer).metadata();
      if (!meta.width || !meta.height) throw new Error('Could not determine input image dimensions');

      const baseW = meta.width;
      const baseH = meta.height;
      const targetOverlayH = Math.max(1, Math.round(baseH * scale));

      let overlayPipeline = sharp(overlayBuffer).resize({ height: targetOverlayH, withoutEnlargement: true });
      if (flip) overlayPipeline = overlayPipeline.flop();
      if (bottom && !flip) overlayPipeline = overlayPipeline.flip();
      const overlayResized = await overlayPipeline.png().toBuffer();
      const overlayMeta = await sharp(overlayResized).metadata();
      const overlayW = overlayMeta.width;
      const overlayH = overlayMeta.height;

      let overlayFinalBuffer = overlayResized;

      if (alpha) {
        try {
          const laplacian = {
            width: 3,
            height: 3,
            kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
          };

          const filledObj = await sharp(overlayResized)
            .greyscale()
            .blur(0.5)
            .threshold(200)
            .raw()
            .toBuffer({ resolveWithObject: true });

          const edgeObj = await sharp(overlayResized)
            .greyscale()
            .convolve(laplacian)
            .abs()
            .blur(0.5)
            .threshold(15)
            .raw()
            .toBuffer({ resolveWithObject: true })
            .catch(async () => {
              return sharp(overlayResized)
                .greyscale()
                .convolve(laplacian)
                .blur(0.5)
                .threshold(15)
                .raw()
                .toBuffer({ resolveWithObject: true });
            });

          const filled = filledObj.data;
          const edge = edgeObj.data;
          const info = filledObj.info;
          const width = info.width;
          const height = info.height;

          if (edge.length !== filled.length || width !== edgeObj.info.width || height !== edgeObj.info.height) {
            throw new Error('Mask calculation produced mismatched sizes');
          }

          const borderMask = Buffer.alloc(width * height);
          for (let i = 0; i < width * height; i++) {
            const isFilled = filled[i] > 128;
            const isEdge = edge[i] > 128;
            borderMask[i] = isFilled && isEdge ? 255 : 0;
          }

          overlayFinalBuffer = await sharp(overlayResized)
            .removeAlpha()
            .joinChannel(borderMask, { raw: { width, height, channels: 1 } })
            .png()
            .toBuffer();
        } catch (maskErr) {
          console.error('speechify: alpha mask creation failed, falling back to original overlay', maskErr);
          overlayFinalBuffer = overlayResized;
        }
      }

      const left = Math.round((baseW - overlayW) / 2);
      const top = bottom ? Math.round(baseH - overlayH) : 0;

      const composedBuffer = await sharp(baseBuffer)
        .composite([{ input: overlayFinalBuffer, left, top, blend: 'over' }])
        .png()
        .toBuffer();

      const out = new AttachmentBuilder(composedBuffer, { name: 'speechified.png' });
      return interaction.editReply({ content: null, files: [out] });
    } catch (err) {
      console.error('speechify: processing failed', err);
      return interaction.editReply({ content: `Failed to process image: ${err && err.message ? err.message : String(err)}` });
    }
  },
};