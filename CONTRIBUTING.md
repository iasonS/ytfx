# Contributing Guide

Welcome! This guide will help you understand how to develop and modify ytfx.

## Getting Started

### Prerequisites
- Node.js 22+
- Python 3 (for yt-dlp)
- Basic understanding of Express.js and async/await

### Local Development Setup

```bash
# Clone and setup
git clone https://github.com/iasonS/ytfx.git
cd ytfx

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add YouTube cookies (optional for development)
# YouTube cookies enable age-restricted video handling
# See README.md for how to export cookies

# Start development server
npm run dev

# Run tests in watch mode
npm run test:watch
```

**Server runs on:** http://localhost:3000

## Before You Code

### 1. Understand the Architecture
Read **ARCHITECTURE.md** to understand:
- Request flow and how embeds are generated
- Cache strategy
- Metrics collection
- Testing structure

### 2. Check the Metrics Guide
Read **METRICS.md** to understand:
- How performance is measured
- How to identify bottlenecks
- Tuning strategies

### 3. Run Tests
Ensure tests pass before making changes:
```bash
npm test
```

All 43+ tests should pass without errors.

## Making Changes

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

**Branch naming conventions:**
- `feature/` - New features
- `fix/` - Bug fixes
- `perf/` - Performance improvements
- `docs/` - Documentation only
- `test/` - Test additions/improvements

### 2. Code Style

**JavaScript conventions:**
- Use `async/await` for async operations (not `.then()`)
- Use descriptive variable names
- Keep functions focused and under 50 lines when possible
- Comment complex logic, but keep comments brief

**Example:**
```javascript
// Good: async/await with clear flow
async function fetchVideoData(videoId) {
  const title = await getTitle(videoId);
  const stream = await getStreamUrl(videoId);
  return { title, stream };
}

// Avoid: Promise chains
function fetchVideoData(videoId) {
  return getTitle(videoId)
    .then(title => getStreamUrl(videoId)
      .then(stream => ({ title, stream })));
}
```

### 3. Add Metrics to New Operations

If you add a new operation that takes time, record metrics:

```javascript
import { recordOperation } from './metrics.js';

async function myNewOperation(videoId) {
  const startTime = Date.now();
  try {
    const result = await someAsyncWork();
    const duration = Date.now() - startTime;
    recordOperation('my-operation', duration, { videoId, status: 'success' });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordOperation('my-operation', duration, { videoId, status: 'error' });
    throw error;
  }
}
```

### 4. Write Tests

**Add tests for:**
- New functions with complex logic
- New endpoints
- Error cases
- Edge cases

**Test file naming:** `tests/{feature}.test.js`

**Example:**
```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('New Feature', () => {
  it('should do something', async () => {
    const response = await request(app)
      .get('/new-endpoint')
      .query({ param: 'value' });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe('expected');
  });

  it('should handle errors', async () => {
    const response = await request(app)
      .get('/new-endpoint')
      .query({ param: 'invalid' });

    expect(response.status).toBe(400);
  });
});
```

**Run tests before committing:**
```bash
npm test
```

## Making Good Commits

### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `perf:` - Performance improvement
- `test:` - Test additions/changes
- `docs:` - Documentation
- `refactor:` - Code cleanup (no behavior change)
- `chore:` - Build/dependency updates

**Example commit messages:**

```
feat: add metrics endpoint for performance monitoring

Adds /metrics and /metrics/history endpoints to track operation
timing and identify bottlenecks. Includes percentile calculations
(p50, p95, p99) for better understanding of request latency.

Fixes #123
```

```
fix: yt-dlp timeout handling on slow networks

Increase timeout from 2s to 3s and add graceful fallback to
default dimensions when extraction fails.

Fixes #456
```

### Before Committing

1. **Run tests:**
   ```bash
   npm test
   ```

2. **Check your changes:**
   ```bash
   git diff
   git status
   ```

3. **Test the server locally:**
   ```bash
   npm run dev
   curl http://localhost:3000/health
   ```

## Submitting a Pull Request

### 1. Push Your Branch

```bash
git push origin feature/your-feature-name
```

### 2. Create PR on GitHub

Include:
- **Title:** Brief description (same as commit message)
- **Description:** What changed and why
- **Testing:** How to test locally
- **Related Issues:** Link any related issues with `Fixes #123`

**PR Template:**
```markdown
## Description
[What does this PR do? Why is the change needed?]

## Changes
- [Change 1]
- [Change 2]

## Testing
[How to test locally? Any new test cases added?]

## Metrics Impact
[Any performance implications? Did you measure with /metrics?]

Fixes #123
```

### 3. Ensure Tests Pass

GitHub Actions runs tests on every PR. Make sure:
- All tests pass locally: `npm test`
- No linting errors
- Code follows the style guide

### 4. Address Review Feedback

- Respond to all comments
- Make changes if requested
- Push new commits (don't force-push during review)

## Performance Considerations

### When Optimizing

1. **Measure first:**
   ```bash
   curl http://localhost:3000/metrics?hours=1
   ```

2. **Identify bottleneck:**
   - Is it oEmbed? yt-dlp? Cache?
   - Check slow operations: look for `[SLOW]` logs

3. **Make change:**
   - Tweak timeout values
   - Adjust format selection
   - Optimize algorithm

4. **Verify improvement:**
   ```bash
   npm test
   curl http://localhost:3000/metrics?hours=1
   ```

**Don't optimize without measurement!**

## Adding Dependencies

Before adding a new npm package:
1. Check if existing code can solve the problem
2. Prefer minimal dependencies
3. Get maintainer approval for new dependencies

```bash
npm install --save new-package
# Update package-lock.json
git add package.json package-lock.json
```

## Documentation

### Update README.md if:
- Adding user-facing features
- Changing environment variables
- Changing deployment steps

### Update ARCHITECTURE.md if:
- Adding new major component
- Changing data flow
- Changing design decisions

### Update METRICS.md if:
- Adding new metrics/operations
- Changing timing collection
- Adding diagnostic endpoints

### Create new .md files for:
- Complex features (e.g., `CACHING.md`)
- Operational guides (e.g., `MONITORING.md`)
- Developer guides (e.g., `DEBUGGING.md`)

## Code Review Checklist

When reviewing code, check:
- [ ] Tests pass: `npm test`
- [ ] Tests cover new code
- [ ] No new warnings or errors
- [ ] Performance impact understood
- [ ] Metrics added for new operations
- [ ] Documentation updated
- [ ] Commit messages follow format
- [ ] No hardcoded values (use env vars)
- [ ] Error handling is graceful
- [ ] Graceful degradation (works partially if something fails)

## Common Development Tasks

### Add a New Endpoint

1. **Update routing** in `index.js`:
   ```javascript
   app.get('/new-endpoint', limiter, analyticsMiddleware, async (req, res) => {
     // Handle request
   });
   ```

2. **Add metrics** if it's slow:
   ```javascript
   const startTime = Date.now();
   // ... do work ...
   recordOperation('my-operation', Date.now() - startTime, { status: 'success' });
   ```

3. **Add tests** in `tests/`:
   ```javascript
   it('should handle /new-endpoint', async () => {
     const res = await request(app).get('/new-endpoint');
     expect(res.status).toBe(200);
   });
   ```

4. **Update README.md** API table

### Improve yt-dlp Performance

1. Edit `getVideoInfo()` in `index.js`
2. Test with metrics: `curl http://localhost:3000/metrics`
3. Verify with slow videos: try famous videos that might have complex extraction

### Fix a Bug

1. Write a test that reproduces the bug
2. Fix the code to make the test pass
3. Ensure all tests still pass
4. Commit with `fix:` prefix

### Profile Performance

```bash
# Start server with detailed logging
NODE_DEBUG=* npm run dev 2>&1 | grep -E "\[SLOW\]|duration|ms"

# Or use metrics endpoint
watch -n 1 'curl -s http://localhost:3000/metrics | jq ".request_flow"'
```

## Getting Help

- **Questions?** Open a GitHub Discussion
- **Found a bug?** Open an Issue with reproduction steps
- **Performance question?** Check METRICS.md first, then ask in Discussions

## Code of Conduct

Be respectful and constructive in all interactions.

- Write clear, helpful code reviews
- Ask for clarification if confused
- Assume good intent
- Focus on code, not people

## Questions?

Check:
1. **README.md** - User documentation
2. **ARCHITECTURE.md** - System design
3. **METRICS.md** - Performance tuning
4. **Test files** - Working examples
5. **GitHub Issues** - Known problems
