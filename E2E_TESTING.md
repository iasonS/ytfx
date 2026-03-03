# End-to-End Testing Guide

ytfx includes comprehensive E2E tests that validate real-world performance and compatibility with actual YouTube and yt-dlp.

## Why E2E Tests?

Unit tests with mocked dependencies can't catch:
- yt-dlp option compatibility issues (like the `--hide-progress` error)
- YouTube API changes
- Network timeouts and failures
- Real performance bottlenecks
- Cache effectiveness with real data

**E2E tests caught the bug:** The unit tests passed, but real yt-dlp calls failed because of an unsupported option.

## Test Coverage

E2E tests validate:

### Real yt-dlp Extraction
- Standard YouTube videos extraction
- YouTube Shorts extraction
- Invalid video ID handling
- Stream URL and metadata accuracy

### oEmbed Integration
- YouTube metadata fetching
- Title and thumbnail extraction
- Error handling for unavailable videos

### Performance
- Embed generation completes in <10 seconds
- Cache hits are significantly faster than cache misses
- Parallel oEmbed + yt-dlp execution

### Metrics Collection
- yt-dlp timing is recorded correctly
- oEmbed timing is recorded correctly
- Timing values are realistic (10-15000ms range)

### Error Handling
- Network failures don't crash the server
- Multiple concurrent requests handled gracefully
- Rate limiting works under load

## Running E2E Tests

### Default: Tests are skipped
By default, E2E tests are **skipped** to keep CI fast:
```bash
npm test
# Result: 65 unit tests passed, 10 E2E tests skipped
```

### Enable and Run E2E Tests

**Option 1: Run with npm script**
```bash
npm run test:e2e
```

**Option 2: Manually enable and run**
1. Edit `tests/e2e.test.js`
2. Change: `describe.skip('E2E Tests...')`
3. To: `describe('E2E Tests...')`
4. Run: `npm test`

**Option 3: Run specific E2E test**
```bash
npx vitest tests/e2e.test.js -t "should extract real stream"
```

## Expected Results

When E2E tests run:

```
 ✓ E2E Tests - Real YouTube & yt-dlp (requires network) (45s)
   ✓ Real yt-dlp extraction (15s)
     ✓ should extract real stream URL from valid video
     ✓ should extract metadata from YouTube Shorts
     ✓ should handle invalid video IDs gracefully
   ✓ oEmbed integration (8s)
     ✓ should fetch oEmbed metadata from YouTube
   ✓ Performance under real conditions (30s)
     ✓ should complete embed generation within 10 seconds
     ✓ should cache results and serve cached content faster
   ...
```

**Total time:** ~45-60 seconds depending on network

## Test Details

### Realistic Video IDs Used

- `dQw4w9WgXcQ` - Rickroll video (famous, always available)
- `jNQXAC9IVRw` - Common test video
- `GaKNSRbi3gw` - YouTube Shorts
- `Sp78zCdzhfA` - Another Shorts

These videos are chosen because they're:
- Widely known and stable
- Unlikely to be removed or restricted
- Good for consistent test results

### Performance Expectations

**oEmbed (YouTube metadata):**
- Min: 10-25ms
- Avg: 50-150ms
- Max: 500-1000ms (network delays)

**yt-dlp (stream extraction):**
- Min: 500-800ms
- Avg: 1000-2000ms
- Max: 5000-10000ms (complex videos, network delays)

**Total (parallel):**
- Min: 800ms
- Avg: 1000-2000ms
- Max: 10000ms

**Cache hit:**
- <10ms (instant)

## Debugging Failed Tests

### Network Timeout
**Error:** `Error: Timeout`
**Cause:** YouTube/yt-dlp taking too long
**Solution:**
- Check internet connection
- Retry test
- YouTube might be rate-limiting

### Video Unavailable
**Error:** `"status": "error"`
**Cause:** Video removed or restricted
**Solution:** Update video ID in test to known-available video

### yt-dlp Option Error
**Error:** `no such option: --some-option`
**Cause:** yt-dlp version incompatibility
**Solution:** Update yt-dlp: `pip install --upgrade yt-dlp`

### Metrics Not Recording
**Error:** `operations count is 0`
**Cause:** Request failed before metrics collection
**Solution:** Check error logs, check yt-dlp installation

## Integration with CI/CD

### Current Setup (GitHub Actions)
- E2E tests are **skipped** in CI to keep builds fast
- Only unit/integration tests run in CI
- E2E tests run manually before production deployment

### Optional: Enable E2E in CI
To enable E2E tests in CI pipeline:

1. Edit `.github/workflows/ci.yml`
2. Add step to enable E2E:
   ```yaml
   - run: npm run test:e2e
     timeout-minutes: 5
   ```
3. Expect CI to take 1-2 minutes longer

**Note:** Not recommended for every commit due to:
- Slow execution (45-60 seconds)
- External dependency (YouTube API)
- Rate limiting risk
- Network unreliability

**Better approach:** Run E2E tests:
- Before major releases
- Before deploying to production
- When changing yt-dlp options
- When debugging compatibility issues

## When to Run E2E Tests

### Required: Before Production Deployment
```bash
# Before: git push origin production
npm run test:e2e
```

### Recommended: After Code Changes to
- yt-dlp options
- YouTube metadata extraction
- Performance optimizations
- Error handling

### Optional: After Updates
- yt-dlp version upgrade
- Node.js version upgrade
- External library updates

## Continuous Monitoring

For production monitoring, use `/metrics` endpoint:
```bash
# Check real performance data
curl https://www.xyyoutube.com/metrics?hours=1 | jq '.request_flow'
```

This gives you real-world performance data without needing to run E2E tests.

## Example: Before/After E2E Testing

### Before E2E Tests
```
✓ All unit tests pass
✓ Code merged
✗ Production error: --hide-progress not supported
```

### With E2E Tests
```
✓ All unit tests pass
✓ E2E tests run against real YouTube
✗ E2E test fails: yt-dlp option error
  → Fix code
  → All tests pass
✓ Code merged confidently
```

## Best Practices

1. **Always run before production deployment**
   ```bash
   npm run test:e2e
   ```

2. **Don't commit breaking yt-dlp changes**
   - Test locally first
   - Run E2E tests
   - Then push

3. **Monitor real metrics in production**
   - Use `/metrics` endpoint
   - Track p95 timing trends
   - Alert on slowdowns

4. **Update test videos if they become unavailable**
   - Tests might start failing if video removed
   - Update to different stable video
   - Commit the change

5. **Document E2E failures**
   - If YouTube changes API, update tests
   - If yt-dlp changes, update options
   - Share findings with team

## Troubleshooting Checklist

- [ ] Internet connection working?
- [ ] yt-dlp installed? (`yt-dlp --version`)
- [ ] Node.js version 18+?
- [ ] Test videos still available?
- [ ] YouTube not rate-limiting?
- [ ] Server timeout high enough?
- [ ] Local DNS working?

## Additional Resources

- [yt-dlp documentation](https://github.com/yt-dlp/yt-dlp/wiki)
- [YouTube oEmbed API](https://developers.google.com/youtube/iframe_api_reference)
- [Vitest docs](https://vitest.dev)
- [METRICS.md](./METRICS.md) - Performance metrics guide
