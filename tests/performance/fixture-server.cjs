const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const buildDir = path.resolve(process.argv[2] || 'dist');
const videoPath = process.argv[3];
const port = Number(process.argv[4]);
if (!videoPath || !port || !fs.existsSync(path.join(buildDir, 'index.html')) || !fs.existsSync(videoPath)) {
  throw new Error('Usage: node tests/performance/fixture-server.cjs <build-dir> <video.mp4> <port>');
}
const spots = Array.from({ length: 300 }, (_, i) => ({
  spot_id: `spot_${i}`, start_ms: i * 6000, end_ms: i * 6000 + 4000, duration_ms: 4000,
  original_start_ms: i * 6000, original_end_ms: i * 6000 + 4000,
  decision: 'generate', text: `บุคคลเดินผ่านประตูหมายเลข ${i}`,
}));
const job = {
  schema_version: 3, job_id: 'benchmark', title: 'benchmark', mode: 'generate', status: 'READY',
  video_metadata: { fileName: 'fixture.mp4', fileSize: 1, mimeType: 'video/mp4', width: 854, height: 480,
    durationMs: 1800000, videoCodec: 'avc1', audioCodec: 'mp4a.40.2', hasAudioTrack: true },
  vad_output: { duration_ms: 1800000, speech_segments: [], candidate_spots: [] }, batches: [], spots,
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/jobs/benchmark') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ job, isRunning: false }));
  }
  if (url.pathname === '/api/jobs/benchmark/video') {
    res.setHeader('Content-Type', 'video/mp4');
    return fs.createReadStream(videoPath).pipe(res);
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }
  const page = url.pathname === '/' || url.pathname.startsWith('/jobs/') ? '/index.html' : url.pathname;
  const target = path.resolve(buildDir, '.' + page);
  if (!target.startsWith(buildDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404); return res.end();
  }
  res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
  fs.createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1');
