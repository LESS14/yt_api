require('dotenv').config();
const express = require('express');
const YouTube = require('youtube-sr').default;
const ytdl = require('ytdl-core');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

const app = express();

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';

const TEMP_BASE_DIR = process.env.TEMP_DIR_BASE || os.tmpdir();
const TEMP_SUB_DIR_NAME = 'youtube_audio_prod';
const TEMP_DIR = path.join(TEMP_BASE_DIR, TEMP_SUB_DIR_NAME);

const LINK_EXPIRATION_MS = parseInt(process.env.LINK_EXPIRATION_MINUTES, 10) * 60 * 1000 || 10 * 60 * 1000;
const FILE_CLEANUP_INTERVAL_MS = parseInt(process.env.FILE_CLEANUP_INTERVAL_MINUTES, 10) * 60 * 1000 || 5 * 60 * 1000;
const FFMPEG_AUDIO_BITRATE = process.env.FFMPEG_AUDIO_BITRATE || '128k';
const MAX_SEARCH_RESULTS = parseInt(process.env.MAX_SEARCH_RESULTS, 10) || 5;

app.use(helmet());

const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

if (NODE_ENV === 'production' && process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY);
}

(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        console.log(`[INIT] Temporary directory at: ${TEMP_DIR}`);
    } catch (err) {
        console.error(`[INIT] Failed to create/verify temporary directory ${TEMP_DIR}:`, err);
        process.exit(1);
    }
})();

async function cleanupOldFiles() {
    console.log('[CLEANUP] Running cleanup of old files...');
    try {
        const files = await fs.readdir(TEMP_DIR);
        if (files.length === 0) {
            console.log('[CLEANUP] No files to clean up.');
            return;
        }
        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stats = await fs.stat(filePath);
                if (Date.now() - stats.mtime.getTime() > LINK_EXPIRATION_MS + 60000) { 
                    await fs.unlink(filePath);
                    console.log(`[CLEANUP] Old file deleted: ${file}`);
                }
            } catch (statErr) {
                if (statErr.code !== 'ENOENT') {
                    console.error(`[CLEANUP] Error getting stats for ${file}:`, statErr);
                }
            }
        }
    } catch (err) {
        console.error('[CLEANUP] Error reading temporary directory:', err);
    }
}
setInterval(cleanupOldFiles, FILE_CLEANUP_INTERVAL_MS);

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    const limit = parseInt(req.query.limit, 10) || MAX_SEARCH_RESULTS;

    if (!query) {
        return res.status(400).json({ error: 'Search query (q) is required.' });
    }
    console.log(`[SEARCH] Query: "${query}", Limit: ${limit}`);
    try {
        const videos = await YouTube.search(query, { limit, type: 'video' });
        res.json(videos.map(v => ({ id: v.id, title: v.title, duration: v.durationFormatted, thumbnail: v.thumbnail?.url, url: v.url })));
    } catch (error) {
        console.error('[SEARCH] Error:', error.message);
        res.status(500).json({ error: 'Failed to search on YouTube.' });
    }
});

app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    if (!videoId || !ytdl.validateID(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID.' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeVideoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
    const outputFileName = `${safeVideoId}.mp3`;
    const outputPath = path.join(TEMP_DIR, outputFileName);
    const playUrl = `${req.protocol}://${req.get('host')}/api/play/${outputFileName}`;

    console.log(`[DOWNLOAD] Request for ${videoId}, Output: ${outputPath}, PlayURL: ${playUrl}`);

    try {
        console.log(`[DOWNLOAD] Getting video info for ${videoId}...`);
        let videoInfo;
        try {
            videoInfo = await ytdl.getInfo(videoUrl);
        } catch (infoError) {
            console.error(`[DOWNLOAD-INFO] Error getting info for ${videoId}: ${infoError.message}`);
            if (infoError.message.includes('private video') || infoError.message.includes('unavailable')) {
                return res.status(403).json({ error: 'This video is private or unavailable.' });
            }
            if (infoError.message.toLowerCase().includes('age-restricted')) {
                 return res.status(403).json({ error: 'This video is age-restricted and cannot be processed at this time.' });
            }
            return res.status(500).json({ error: 'Failed to get video information.', details: infoError.message });
        }

        if (videoInfo.player_response && videoInfo.player_response.playabilityStatus) {
            const { status, reason, errorScreen } = videoInfo.player_response.playabilityStatus;
            if (status === 'UNPLAYABLE' || status === 'ERROR') {
                console.warn(`[DOWNLOAD-INFO] Video ${videoId} is unplayable. Status: ${status}, Reason: ${reason}`);
                let userMessage = 'This video cannot be played.';
                if (reason) userMessage += ` Reason: ${reason}`;

                const reasonLower = (reason || "").toLowerCase();
                const errorScreenTitleLower = (errorScreen?.playerLegacyDesktopWatchAdsRenderer?.title?.simpleText || "").toLowerCase();

                if (reasonLower.includes('age restricted') ||
                    reasonLower.includes('sign in to confirm your age') ||
                    errorScreenTitleLower.includes('age-restricted') ||
                    errorScreenTitleLower.includes('confirm your age')) {
                    userMessage = 'This video is age-restricted and cannot be processed.';
                    return res.status(403).json({ error: userMessage });
                }
                return res.status(403).json({ error: userMessage });
            }
            if (status === 'LOGIN_REQUIRED') {
                 console.warn(`[DOWNLOAD-INFO] Video ${videoId} requires login. Status: ${status}, Reason: ${reason}`);
                 let userMessage = 'This video requires login to be accessed, which may indicate age restriction or other limitations.';
                 if (reason && (reason.toLowerCase().includes('age restricted') || reason.toLowerCase().includes('sign in to confirm your age'))) {
                    userMessage = 'This video is age-restricted and requires login for confirmation.';
                 }
                 return res.status(403).json({ error: userMessage });
            }
        }
        console.log(`[DOWNLOAD-INFO] Info obtained for ${videoId}. Title: ${videoInfo.videoDetails.title}`);


        const stats = await fs.stat(outputPath).catch(() => null);
        if (stats && stats.size > 0 && (Date.now() - stats.mtime.getTime() < LINK_EXPIRATION_MS)) {
            console.log(`[DOWNLOAD] Using existing file for ${videoId}`);
            return res.json({
                message: 'Audio already processed.',
                playUrl,
                fileName: outputFileName,
                expiresInSeconds: Math.round((LINK_EXPIRATION_MS - (Date.now() - stats.mtime.getTime())) / 1000)
            });
        }

        console.log(`[DOWNLOAD] Processing ${videoId}`);
        const audioStream = ytdl(videoUrl, {
            quality: 'highestaudio',
            filter: 'audioonly',
        });
        
        audioStream.on('error', (err) => {
            console.error(`[YTDL-ERROR] Stream error for ${videoId}: ${err.message}`);
            if (!res.headersSent) {
                let userMessage = 'Failed to get audio stream from YouTube.';
                if (err.message.toLowerCase().includes('age-restricted') || err.message.toLowerCase().includes('login required')) {
                    userMessage = 'This video appears to be age-restricted or requires login, and the stream could not be accessed.';
                     return res.status(403).json({ error: userMessage, details: err.message });
                }
                res.status(500).json({ error: userMessage, details: err.message });
            }
        });

        ffmpeg(audioStream)
            .audioCodec('libmp3lame')
            .audioBitrate(FFMPEG_AUDIO_BITRATE)
            .format('mp3')
            .on('start', cmd => console.log(`[FFMPEG] Started transcoding for ${outputFileName}: ${cmd.substring(0, 200)}...`))
            .on('error', (err, stdout, stderr) => {
                console.error(`[FFMPEG] Error transcoding for ${videoId}: ${err.message}`);
                if (NODE_ENV !== 'production') {
                    console.error(`[FFMPEG] stdout: ${stdout}`);
                    console.error(`[FFMPEG] stderr: ${stderr}`);
                }
                fs.unlink(outputPath).catch(() => {});
                if (!res.headersSent) {
                    const errMsgLower = err.message.toLowerCase();
                    if (errMsgLower.includes('403 forbidden') || errMsgLower.includes('age restricted') || errMsgLower.includes('login required')) {
                        return res.status(403).json({ error: 'Failed to process audio due to video restrictions.', details: err.message });
                    }
                    res.status(500).json({ error: 'Failed to transcode audio.', details: err.message });
                }
            })
            .on('end', async () => {
                console.log(`[FFMPEG] Transcoding for ${outputFileName} completed.`);
                try {
                    const finalStats = await fs.stat(outputPath);
                    if (!finalStats || finalStats.size === 0) {
                        throw new Error('Transcoded file not found or empty.');
                    }
                    console.log(`[FFMPEG] ${outputFileName} saved. Size: ${finalStats.size} bytes.`);
                    
                    setTimeout(() => {
                        fs.unlink(outputPath)
                            .then(() => console.log(`[DOWNLOAD] File ${outputFileName} deleted (expired).`))
                            .catch(unlinkErr => {
                                if (unlinkErr.code !== 'ENOENT') {
                                    console.error(`[DOWNLOAD] Error deleting ${outputFileName} (scheduled):`, unlinkErr);
                                }
                            });
                    }, LINK_EXPIRATION_MS);

                    if (!res.headersSent) {
                        res.json({
                            message: 'Audio processed.',
                            playUrl,
                            fileName: outputFileName,
                            expiresInSeconds: Math.round(LINK_EXPIRATION_MS / 1000)
                        });
                    }
                } catch (finalStatError) {
                    console.error(`[FFMPEG] Post-transcoding error for ${outputFileName}: ${finalStatError.message}`);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Failed to verify transcoded file.' });
                    }
                }
            })
            .save(outputPath);

    } catch (error) {
        console.error(`[DOWNLOAD] General error for ${videoId}:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to start processing.', details: error.message });
        }
    }
});


app.get('/api/play/:fileName', async (req, res, next) => {
    const { fileName } = req.params;
    console.log(`[PLAY] Request for: ${fileName}`);

    if (fileName.includes('..') || !fileName.endsWith('.mp3')) {
        console.warn(`[PLAY] Invalid filename: ${fileName}`);
        return res.status(400).send('Invalid filename.');
    }
    const filePath = path.join(TEMP_DIR, fileName);

    try {
        const stats = await fs.stat(filePath);
        if (Date.now() - stats.mtime.getTime() > LINK_EXPIRATION_MS + 120000) {
            console.log(`[PLAY] File expired: ${fileName}. Removing.`);
            await fs.unlink(filePath).catch(() => {});
            return res.status(410).send('Link expired and file removed.');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');
        
        const stream = require('fs').createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', (err) => {
            console.error(`[PLAY] Error streaming ${fileName}:`, err);
            if (!res.headersSent) {
                next(err);
            }
        });
        stream.on('close', () => console.log(`[PLAY] Stream finished for ${fileName}.`));

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[PLAY] File not found: ${fileName}`);
            res.status(404).send('File not found or link expired.');
        } else {
            console.error(`[PLAY] Error serving ${fileName}:`, error);
            next(error);
        }
    }
});

app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found.' });
});

app.use((err, req, res, next) => {
    console.error("[ERROR-HANDLER] Error:", err.message);
    if (NODE_ENV !== 'production' && err.stack) {
        console.error(err.stack);
    }
    if (res.headersSent) {
        return next(err);
    }
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
        error: NODE_ENV === 'production' && statusCode === 500 ? 'Internal server error.' : err.message
    });
});


const server = app.listen(PORT, HOST, () => {
    console.log(`[INIT] Server ${NODE_ENV} running at http://${HOST}:${PORT}`);
    console.log(`[INIT] Temporary files in: ${TEMP_DIR}`);
    console.log(`[INIT] MP3 audio ${FFMPEG_AUDIO_BITRATE}. Expiration: ${LINK_EXPIRATION_MS / 60000} min.`);
    
    try {
        ffmpeg.getAvailableCodecs((err, codecs) => {
            if (err) throw err;
            if (codecs.libmp3lame?.canEncode) {
                console.log("[FFMPEG-CHECK] Codec libmp3lame (MP3) available.");
            } else {
                console.warn("[FFMPEG-CHECK] Codec libmp3lame (MP3) NOT available!");
            }
        });
    } catch(e) {
        console.error("[FFMPEG-CHECK] Error checking FFmpeg. Is it installed and in PATH?", e.message);
    }
    cleanupOldFiles();
});

const gracefulShutdown = (signal) => {
    console.log(`[SYSTEM] Received ${signal} signal. Shutting down gracefully...`);
    server.close(() => {
        console.log('[SYSTEM] HTTP connections closed.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('[SYSTEM] Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
    console.error('[SYSTEM] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[SYSTEM] Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});