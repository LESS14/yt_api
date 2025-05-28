#include <open.mp>
#include <crashdetect>
#include <sscanf2>
#include <YSI_Visual/y_commands>
#include <yt_api>

main(){}

public OnGameModeInit()
{
    printf("[MusicCommands] Script de comandos de música carregado.");
    printf("[MusicCommands] Use /searchmusic [termos] para buscar.");
    printf("[MusicCommands] Use /playtrack [numero] para tocar uma música da lista.");
    printf("[MusicCommands] Use /stopmusic para parar a música.");
    return 1;
}

public OnGameModeExit() {
    printf("[MusicCommands] Script de comandos de música descarregado.");
    return 1;
}


public OnPlayerRequestMusicList(playerid, key_words[], bool:error) {
    if(!IsPlayerConnected(playerid)) return 1;

    if(error) {
        SendClientMessage(playerid, 0xFF6347AA, "[MÚSICA] Ocorreu um erro ao buscar sua música. Tente novamente.");
        printf("[MusicCmds] Erro na busca para player %d, palavras-chave: %s", playerid, key_words);
        return 1;
    }

    new pool_size = GetPlayerMusicPoolSize(playerid);
    if(pool_size == 0) {
        new message[128 + MAX_MUSIC_SEARCH_LENGTH];
        format(message, sizeof(message), "[MÚSICA] Nenhum resultado encontrado para: '%s'", key_words);
        SendClientMessage(playerid, 0xFFFFE0AA, message);
        return 1;
    }

    SendClientMessage(playerid, 0x6495EDAA, "--- Resultados da Busca ---");
    new track_info[MAX_MUSIC_ARTIST_LENGTH + MAX_MUSIC_NAME_LENGTH + MAX_MUSIC_DURATION_LENGTH + 20];
    
    new music_artist_name[MAX_MUSIC_ARTIST_LENGTH], music_name[MAX_MUSIC_NAME_LENGTH], music_duration[MAX_MUSIC_DURATION_LENGTH];

    for(new i = 0; i < pool_size; i++) {
        GetPlayerMusicArtist(playerid, i, music_artist_name);
        GetPlayerMusicName(playerid, i, music_name);
        GetPlayerMusicDuration(playerid, i, music_duration);


        format(track_info, sizeof(track_info), "{BDB76B}%d. {FFFFFF}%s - %s (%s)", i + 1, music_artist_name, music_name, music_duration);
        SendClientMessage(playerid, 0xA9A9A9AA, track_info);
    }
    SendClientMessage(playerid, 0x6495EDAA, "Use /playtrack [numero] para tocar.");
    return 1;
}



@cmd() searchmusic(playerid, params[], help) {
    new song[30];

    if(sscanf(params, "s[30]", song)) return SendClientMessage(playerid, 0xC0C0C0AA, "USO: /searchmusic [termos da busca]");
   
    SendClientMessage(playerid, 0xA9A9A9AA, "[MÚSICA] Buscando, por favor aguarde...");
    MusicSearchByKey(playerid, song);
    return 1;
}

@cmd() playtrack(playerid, params[], help) {
    new track_number;

    if(sscanf(params, "i", track_number)) return SendClientMessage(playerid, 0xC0C0C0AA, "USO: /playtrack [numero da música na lista]");

    if(track_number < 1 || track_number > MAX_MUSIC_SEARCH_ITEMS) {
        SendClientMessage(playerid, 0xFF6347AA, "[MÚSICA] Número da música inválido.");
        return 1;
    }

    if(track_number > GetPlayerMusicPoolSize(playerid)) {
        SendClientMessage(playerid, 0xFF6347AA, "[MÚSICA] Número da música fora do alcance dos resultados atuais.");
        return 1;
    }

    PlayMusic(playerid, track_number - 1);
    return 1;
}

@cmd() stoptrack(playerid, params[], help) {
    StopAudioStreamForPlayer(playerid);
    SendClientMessage(playerid, 0x32CD32AA, "[MÚSICA] Música parada.");
    return 1;
}