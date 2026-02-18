import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'icon.png', size: 512 },
  { name: 'Square30x30Logo.png', size: 30 },
  { name: 'Square44x44Logo.png', size: 44 },
  { name: 'Square71x71Logo.png', size: 71 },
  { name: 'Square89x89Logo.png', size: 89 },
  { name: 'Square107x107Logo.png', size: 107 },
  { name: 'Square142x142Logo.png', size: 142 },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square284x284Logo.png', size: 284 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'StoreLogo.png', size: 50 },
];

// macOS iconset sizes
const icnsIconsetSizes = [16, 32, 64, 128, 256, 512, 1024];

async function convert() {
  // Generate standard PNGs
  for (const { name, size } of sizes) {
    const outputPath = join(__dirname, name);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Created ${name} (${size}x${size})`);
  }

  // Generate macOS .icns file using iconutil
  console.log('\nGenerating macOS .icns...');
  const iconsetPath = join(__dirname, 'icon.iconset');

  // Clean up old iconset if exists
  if (existsSync(iconsetPath)) {
    rmSync(iconsetPath, { recursive: true });
  }
  mkdirSync(iconsetPath);

  // Generate all required sizes for iconset
  const icnsSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  for (const { name, size } of icnsSizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(iconsetPath, name));
  }

  try {
    execSync(`iconutil -c icns "${iconsetPath}" -o "${join(__dirname, 'icon.icns')}"`, { stdio: 'inherit' });
    console.log('Created icon.icns');
  } catch (error) {
    console.error('Failed to create .icns file:', error.message);
  }

  // Clean up iconset folder
  rmSync(iconsetPath, { recursive: true });

  // Generate Windows .ico file
  console.log('\nGenerating Windows .ico...');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = [];

  for (const size of icoSizes) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    icoBuffers.push({ size, buffer });
  }

  // Create ICO file manually
  const icoBuffer = createIcoBuffer(icoBuffers);
  writeFileSync(join(__dirname, 'icon.ico'), icoBuffer);
  console.log('Created icon.ico');

  console.log('\nAll icons generated successfully!');
}

function createIcoBuffer(images) {
  // ICO header: 6 bytes
  // ICO directory entry: 16 bytes per image
  // Image data follows

  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = images.length;

  // Calculate total size
  let totalDataSize = headerSize + (dirEntrySize * numImages);
  const imageOffsets = [];

  for (const img of images) {
    imageOffsets.push(totalDataSize);
    totalDataSize += img.buffer.length;
  }

  const buffer = Buffer.alloc(totalDataSize);
  let offset = 0;

  // ICO header
  buffer.writeUInt16LE(0, offset); offset += 2;      // Reserved, must be 0
  buffer.writeUInt16LE(1, offset); offset += 2;      // Image type: 1 = ICO
  buffer.writeUInt16LE(numImages, offset); offset += 2; // Number of images

  // Directory entries
  for (let i = 0; i < numImages; i++) {
    const img = images[i];
    const size = img.size >= 256 ? 0 : img.size; // 0 means 256

    buffer.writeUInt8(size, offset); offset += 1;           // Width
    buffer.writeUInt8(size, offset); offset += 1;           // Height
    buffer.writeUInt8(0, offset); offset += 1;              // Color palette
    buffer.writeUInt8(0, offset); offset += 1;              // Reserved
    buffer.writeUInt16LE(1, offset); offset += 2;           // Color planes
    buffer.writeUInt16LE(32, offset); offset += 2;          // Bits per pixel
    buffer.writeUInt32LE(img.buffer.length, offset); offset += 4;  // Image size
    buffer.writeUInt32LE(imageOffsets[i], offset); offset += 4;    // Image offset
  }

  // Image data
  for (const img of images) {
    img.buffer.copy(buffer, offset);
    offset += img.buffer.length;
  }

  return buffer;
}

convert().catch(console.error);
