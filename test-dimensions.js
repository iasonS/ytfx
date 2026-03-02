import youtubeDlExec from 'youtube-dl-exec';

// Test shorts video
const shortsId = 'Sp78zCdzhfA';
const shortsUrl = `https://www.youtube.com/shorts/${shortsId}`;

console.log('🔍 Testing yt-dlp dimensions for Shorts...\n');
console.log(`Video: ${shortsUrl}\n`);

try {
  const result = await youtubeDlExec(shortsUrl, {
    dumpJson: true,
    format: '18',
    noWarnings: true,
    quiet: true,
  });

  console.log('✓ yt-dlp output:');
  console.log(`  Title: ${result.title}`);
  console.log(`  Video dimensions: ${result.width}x${result.height}`);
  console.log(`  Video aspect ratio: ${(result.width / result.height).toFixed(2)}`);

  if (result.formats && result.formats.length > 0) {
    console.log(`\n✓ Available formats:`);
    result.formats.slice(0, 5).forEach((f, i) => {
      if (f.width && f.height) {
        console.log(`  [${i}] ${f.format_id}: ${f.width}x${f.height} (${f.ext})`);
      }
    });
  }

  // Check what we're currently sending
  console.log(`\n📤 Current metadata we send to Discord:`);
  console.log(`  og:image:width: 1280`);
  console.log(`  og:image:height: 720`);
  console.log(`  og:video:width: 1280`);
  console.log(`  og:video:height: 720`);
  console.log(`  Aspect ratio: ${(1280/720).toFixed(2)} (16:9 - HORIZONTAL)`);

  console.log(`\n⚠️  ACTUAL video is: ${result.width}x${result.height}`);
  console.log(`⚠️  Aspect ratio mismatch: ${(result.width/result.height).toFixed(2)}`);

} catch (error) {
  console.error('Error:', error.message);
}
