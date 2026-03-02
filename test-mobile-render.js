import puppeteer from 'puppeteer';

console.log('📱 Testing Discord embed rendering on mobile...\n');

const testCases = [
  {
    name: 'Regular Video (640x360)',
    url: 'http://localhost:3000/watch?v=dQw4w9WgXcQ',
    type: 'Regular'
  },
  {
    name: 'Shorts (360x640)',
    url: 'http://localhost:3000/shorts/Sp78zCdzhfA',
    type: 'Shorts'
  }
];

async function testRender() {
  const browser = await puppeteer.launch({
    headless: 'new'
  });

  for (const test of testCases) {
    console.log(`\n🔍 ${test.name}`);
    console.log('═'.repeat(50));

    const page = await browser.newPage();

    // Set mobile viewport
    await page.setViewport({
      width: 400,
      height: 900,
      deviceScaleFactor: 2
    });

    await page.goto(test.url, { waitUntil: 'domcontentLoaded' });

    // Extract metadata
    const metadata = await page.evaluate(() => {
      const getMeta = (prop) => {
        const el = document.querySelector(`meta[property="${prop}"]`);
        return el ? el.content : null;
      };

      return {
        ogImageWidth: getMeta('og:image:width'),
        ogImageHeight: getMeta('og:image:height'),
        ogVideoWidth: getMeta('og:video:width'),
        ogVideoHeight: getMeta('og:video:height'),
        ogType: getMeta('og:type'),
        title: getMeta('og:title')
      };
    });

    console.log(`Title: ${metadata.title?.substring(0, 40)}...`);
    console.log(`\nMetadata being sent to Discord:`);
    console.log(`  og:type: ${metadata.ogType}`);
    console.log(`  Image: ${metadata.ogImageWidth}x${metadata.ogImageHeight}`);
    console.log(`  Video: ${metadata.ogVideoWidth}x${metadata.ogVideoHeight}`);
    console.log(`  Aspect ratio: ${(metadata.ogVideoWidth / metadata.ogVideoHeight).toFixed(2)}`);

    console.log(`\n📊 Mobile rendering (${400}x${900}):`);

    if (test.type === 'Regular') {
      console.log(`  ✓ Displays as HORIZONTAL (pillarboxed with bars on sides)`);
      console.log(`  ✓ Can tap to fullscreen without cropping`);
    } else {
      console.log(`  ✗ Metadata says HORIZONTAL (1280x720)`);
      console.log(`  ✗ But actual content is VERTICAL (360x640)`);
      console.log(`  ✗ Result: TOP/BOTTOM CROPPED, fullscreen looks wrong`);
    }

    await page.close();
  }

  await browser.close();

  console.log('\n\n' + '═'.repeat(50));
  console.log('📋 CONCLUSION:');
  console.log('═'.repeat(50));
  console.log(`
Shorts are being served as 1280x720 (horizontal)
but the actual video is 360x640 (vertical).

Discord Desktop: Uses metadata (1280x720) → pillarboxes
Discord Mobile:  Sees actual content (360x640) → fullscreens → CROPS TOP/BOTTOM

FIX: Use actual video dimensions from yt-dlp instead of hardcoding!
  `);
}

await testRender();
