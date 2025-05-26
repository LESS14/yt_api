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
    message: { error: 'Muitas requisi��es, por favor, tente novamente mais tarde.' },
});
app.use('/api/', apiLimiter);

if (NODE_ENV === 'production' && process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY);
}

(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
        console.log(`[INIT] Diret�rio tempor�rio em: ${TEMP_DIR}`);
    } catch (err) {
        console.error(`[INIT] Falha ao criar/verificar diret�rio tempor�rio ${TEMP_DIR}:`, err);
        process.exit(1);
    }
})();

async function cleanupOldFiles() {
    console.log('[CLEANUP] Executando limpeza de arquivos antigos...');
    try {
        const files = await fs.readdir(TEMP_DIR);
        if (files.length === 0) {
            console.log('[CLEANUP] Nenhum arquivo para limpar.');
            return;
        }
        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stats = await fs.stat(filePath);
                if (Date.now() - stats.mtime.getTime() > LINK_EXPIRATION_MS + 60000) {
                    await fs.unlink(filePath);
                    console.log(`[CLEANUP] Arquivo antigo deletado: ${file}`);
                }
            } catch (statErr) {
                if (statErr.code !== 'ENOENT') {
                    console.error(`[CLEANUP] Erro ao obter stats para ${file}:`, statErr);
                }
            }
        }
    } catch (err) {
        console.error('[CLEANUP] Erro ao ler diret�rio tempor�rio:', err);
    }
}
setInterval(cleanupOldFiles, FILE_CLEANUP_INTERVAL_MS);

app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    const limit = parseInt(req.query.limit, 10) || MAX_SEARCH_RESULTS;

    if (!query) {
        return res.status(400).json({ error: 'Query de busca (q) � obrigat�ria.' });
    }
    console.log(`[SEARCH] Query: "${query}", Limite: ${limit}`);
    try {
        const videos = await YouTube.search(query, { limit, type: 'video' });
        res.json(videos.map(v => ({ id: v.id, title: v.title, duration: v.durationFormatted, thumbnail: v.thumbnail?.url, url: v.url })));
    } catch (error) {
        console.error('[SEARCH] Erro:', error.message);
        res.status(500).json({ error: 'Falha ao buscar no YouTube.' });
    }
});

app.get('/api/download/:videoId', async (req, res) => {
    const { videoId } = req.params;
    if (!videoId || !ytdl.validateID(videoId)) {
        return res.status(400).json({ error: 'ID de v�deo inv�lido.' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const safeVideoId = videoId.replace(/[^a-zA-Z0-9_-]/g, '');
    const outputFileName = `${safeVideoId}.mp3`;
    const outputPath = path.join(TEMP_DIR, outputFileName);
    const playUrl = `${req.protocol}://${req.get('host')}/api/play/${outputFileName}`;

    console.log(`[DOWNLOAD] Req para ${videoId}, Sa�da: ${outputPath}, PlayURL: ${playUrl}`);

    try {
        console.log(`[DOWNLOAD] Obtendo informa��es do v�deo ${videoId}...`);
        let videoInfo;
        try {
            videoInfo = await ytdl.getInfo(videoUrl);
        } catch (infoError) {
            console.error(`[DOWNLOAD-INFO] Erro ao obter informa��es para ${videoId}: ${infoError.message}`);
            if (infoError.message.includes('private video') || infoError.message.includes('unavailable')) {
                return res.status(403).json({ error: 'Este v�deo � privado ou indispon�vel.' });
            }
            if (infoError.message.toLowerCase().includes('age-restricted')) {
                 return res.status(403).json({ error: 'Este v�deo tem restri��o de idade e n�o pode ser processado no momento.' });
            }
            return res.status(500).json({ error: 'Falha ao obter informa��es do v�deo.', details: infoError.message });
        }

        if (videoInfo.player_response && videoInfo.player_response.playabilityStatus) {
            const { status, reason, errorScreen } = videoInfo.player_response.playabilityStatus;
            if (status === 'UNPLAYABLE' || status === 'ERROR') {
                console.warn(`[DOWNLOAD-INFO] V�deo ${videoId} n�o toc�vel. Status: ${status}, Raz�o: ${reason}`);
                let userMessage = 'Este v�deo n�o pode ser reproduzido.';
                if (reason) userMessage += ` Raz�o: ${reason}`;
                
                const reasonLower = (reason || "").toLowerCase();
                const errorScreenTitleLower = (errorScreen?.playerLegacyDesktopWatchAdsRenderer?.title?.simpleText || "").toLowerCase();

                if (reasonLower.includes('age restricted') || 
                    reasonLower.includes('sign in to confirm your age') ||
                    errorScreenTitleLower.includes('age-restricted') ||
                    errorScreenTitleLower.includes('confirm your age')) {
                    userMessage = 'Este v�deo tem restri��o de idade e n�o pode ser processado.';
                    return res.status(403).json({ error: userMessage });
                }
                return res.status(403).json({ error: userMessage });
            }
            if (status === 'LOGIN_REQUIRED') {
                 console.warn(`[DOWNLOAD-INFO] V�deo ${videoId} requer login. Status: ${status}, Raz�o: ${reason}`);
                 let userMessage = 'Este v�deo requer login para ser acessado, o que pode indicar restri��o de idade ou outras limita��es.';
                 if (reason && (reason.toLowerCase().includes('age restricted') || reason.toLowerCase().includes('sign in to confirm your age'))) {
                    userMessage = 'Este v�deo tem restri��o de idade e requer login para confirma��o.';
                 }
                 return res.status(403).json({ error: userMessage });
            }
        }
        console.log(`[DOWNLOAD-INFO] Informa��es obtidas para ${videoId}. T�tulo: ${videoInfo.videoDetails.title}`);


        const stats = await fs.stat(outputPath).catch(() => null);
        if (stats && stats.size > 0 && (Date.now() - stats.mtime.getTime() < LINK_EXPIRATION_MS)) {
            console.log(`[DOWNLOAD] Usando arquivo existente para ${videoId}`);
            return res.json({
                message: '�udio j� processado.',
                playUrl,
                fileName: outputFileName,
                expiresInSeconds: Math.round((LINK_EXPIRATION_MS - (Date.now() - stats.mtime.getTime())) / 1000)
            });
        }

        console.log(`[DOWNLOAD] Processando ${videoId}`);
        const audioStream = ytdl(videoUrl, {
            quality: 'highestaudio',
            filter: 'audioonly',
        });
        
        audioStream.on('error', (err) => {
            console.error(`[YTDL-ERROR] Stream error for ${videoId}: ${err.message}`);
            if (!res.headersSent) {
                let userMessage = 'Falha ao obter stream de �udio do YouTube.';
                if (err.message.toLowerCase().includes('age-restricted') || err.message.toLowerCase().includes('login required')) {
                    userMessage = 'Este v�deo parece ter restri��o de idade ou requer login, e o stream n�o p�de ser acessado.';
                     return res.status(403).json({ error: userMessage, details: err.message });
                }
                res.status(500).json({ error: userMessage, details: err.message });
            }
        });

        ffmpeg(audioStream)
            .audioCodec('libmp3lame')
            .audioBitrate(FFMPEG_AUDIO_BITRATE)
            .format('mp3')
            .on('start', cmd => console.log(`[FFMPEG] Iniciada transcodifica��o para ${outputFileName}: ${cmd.substring(0, 200)}...`))
            .on('error', (err, stdout, stderr) => {
                console.error(`[FFMPEG] Erro na transcodifica��o para ${videoId}: ${err.message}`);
                if (NODE_ENV !== 'production') {
                    console.error(`[FFMPEG] stdout: ${stdout}`);
                    console.error(`[FFMPEG] stderr: ${stderr}`);
                }
                fs.unlink(outputPath).catch(() => {});
                if (!res.headersSent) {
                    const errMsgLower = err.message.toLowerCase();
                    if (errMsgLower.includes('403 forbidden') || errMsgLower.includes('age restricted') || errMsgLower.includes('login required')) {
                        return res.status(403).json({ error: 'Falha ao processar �udio devido a restri��es do v�deo.', details: err.message });
                    }
                    res.status(500).json({ error: 'Falha ao transcodificar �udio.', details: err.message });
                }
            })
            .on('end', async () => {
                console.log(`[FFMPEG] Transcodifica��o para ${outputFileName} conclu�da.`);
                try {
                    const finalStats = await fs.stat(outputPath);
                    if (!finalStats || finalStats.size === 0) {
                        throw new Error('Arquivo transcodificado n�o encontrado ou vazio.');
                    }
                    console.log(`[FFMPEG] ${outputFileName} salvo. Tamanho: ${finalStats.size} bytes.`);
                    
                    setTimeout(() => {
                        fs.unlink(outputPath)
                            .then(() => console.log(`[DOWNLOAD] Arquivo ${outputFileName} deletado (expirado).`))
                            .catch(unlinkErr => {
                                if (unlinkErr.code !== 'ENOENT') {
                                    console.error(`[DOWNLOAD] Erro ao deletar ${outputFileName} (agendado):`, unlinkErr);
                                }
                            });
                    }, LINK_EXPIRATION_MS);

                    if (!res.headersSent) {
                        res.json({
                            message: '�udio processado.',
                            playUrl,
                            fileName: outputFileName,
                            expiresInSeconds: Math.round(LINK_EXPIRATION_MS / 1000)
                        });
                    }
                } catch (finalStatError) {
                    console.error(`[FFMPEG] Erro p�s-transcodifica��o ${outputFileName}: ${finalStatError.message}`);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Falha ao verificar arquivo transcodificado.' });
                    }
                }
            })
            .save(outputPath);

    } catch (error) {
        console.error(`[DOWNLOAD] Erro geral para ${videoId}:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Falha ao iniciar processamento.', details: error.message });
        }
    }
});


app.get('/api/play/:fileName', async (req, res, next) => {
    const { fileName } = req.params;
    console.log(`[PLAY] Req para: ${fileName}`);

    if (fileName.includes('..') || !fileName.endsWith('.mp3')) {
        console.warn(`[PLAY] Nome de arquivo inv�lido: ${fileName}`);
        return res.status(400).send('Nome de arquivo inv�lido.');
    }
    const filePath = path.join(TEMP_DIR, fileName);

    try {
        const stats = await fs.stat(filePath);
        if (Date.now() - stats.mtime.getTime() > LINK_EXPIRATION_MS + 120000) {
            console.log(`[PLAY] Arquivo expirado: ${fileName}. Removendo.`);
            await fs.unlink(filePath).catch(() => {});
            return res.status(410).send('Link expirado e arquivo removido.');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');
        
        const stream = require('fs').createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', (err) => {
            console.error(`[PLAY] Erro ao streamar ${fileName}:`, err);
            if (!res.headersSent) {
                next(err);
            }
        });
        stream.on('close', () => console.log(`[PLAY] Stream finalizado para ${fileName}.`));

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[PLAY] Arquivo n�o encontrado: ${fileName}`);
            res.status(404).send('Arquivo n�o encontrado ou link expirado.');
        } else {
            console.error(`[PLAY] Erro ao servir ${fileName}:`, error);
            next(error);
        }
    }
});

app.use((req, res, next) => {
    res.status(404).json({ error: 'Rota n�o encontrada.' });
});

app.use((err, req, res, next) => {
    console.error("[ERROR-HANDLER] Erro:", err.message);
    if (NODE_ENV !== 'production' && err.stack) {
        console.error(err.stack);
    }
    if (res.headersSent) {
        return next(err);
    }
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
        error: NODE_ENV === 'production' && statusCode === 500 ? 'Erro interno do servidor.' : err.message
    });
});


const server = app.listen(PORT, HOST, () => {
    console.log(`[INIT] Servidor ${NODE_ENV} rodando em http://${HOST}:${PORT}`);
    console.log(`[INIT] Arquivos tempor�rios em: ${TEMP_DIR}`);
    console.log(`[INIT] �udio MP3 ${FFMPEG_AUDIO_BITRATE}. Expira��o: ${LINK_EXPIRATION_MS / 60000} min.`);
    
    try {
        ffmpeg.getAvailableCodecs((err, codecs) => {
            if (err) throw err;
            if (codecs.libmp3lame?.canEncode) {
                console.log("[FFMPEG-CHECK] Codec libmp3lame (MP3) dispon�vel.");
            } else {
                console.warn("[FFMPEG-CHECK] Codec libmp3lame (MP3) N�O dispon�vel!");
            }
        });
    } catch(e) {
        console.error("[FFMPEG-CHECK] Erro ao verificar FFmpeg. Est� instalado e no PATH?", e.message);
    }
    cleanupOldFiles();
});

const gracefulShutdown = (signal) => {
    console.log(`[SYSTEM] Recebido sinal ${signal}. Desligando graciosamente...`);
    server.close(() => {
        console.log('[SYSTEM] Conex�es HTTP fechadas.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('[SYSTEM] Desligamento gracioso demorou demais. For�ando desligamento.');
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