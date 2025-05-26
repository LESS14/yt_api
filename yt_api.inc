// Com base nos estudos de Dr Editor (mustream) - https://portalsamp.com/showthread.php?tid=3334

#if defined _yt_api_included
	#endinput
#endif
#define _yt_api_included

#include <open.mp>
#include <YSI_Coding/y_hooks>
#include <strlib>
#include <requests>
#include <map>

#define API_BASE_URL        "http://127.0.0.1:9000"
// --------------------------

#define MAX_MUSIC_SEARCH_ITEMS					8
#define MAX_MUSIC_SEARCH_LENGTH					60
#define MAX_MUSIC_ID_LENGTH                     32
#define MAX_MUSIC_ARTIST_LENGTH                 80
#define MAX_MUSIC_NAME_LENGTH                   120
#define MAX_MUSIC_DURATION_LENGTH               10
#define MAX_API_PATH_LENGTH                     (128 + MAX_MUSIC_SEARCH_LENGTH * 3)
#define MAX_PLAY_URL_LENGTH                     512

static __musicPlayerDataID[MAX_PLAYERS][MAX_MUSIC_SEARCH_ITEMS][MAX_MUSIC_ID_LENGTH];
static __musicPlayerDataArtist[MAX_PLAYERS][MAX_MUSIC_SEARCH_ITEMS][MAX_MUSIC_ARTIST_LENGTH];
static __musicPlayerDataName[MAX_PLAYERS][MAX_MUSIC_SEARCH_ITEMS][MAX_MUSIC_NAME_LENGTH];
static __musicPlayerDataDuration[MAX_PLAYERS][MAX_MUSIC_SEARCH_ITEMS][MAX_MUSIC_DURATION_LENGTH];

static __musicPlayerSearchOriginal[MAX_PLAYERS][MAX_MUSIC_SEARCH_LENGTH + 1];
static __musicPlayerSelectedMusicIndex[MAX_PLAYERS] = {-1, ...};
static __musicIndexCount[MAX_PLAYERS];

static RequestsClient:MusicApiClient;
static Map:RequestToPlayerIdMap;

forward OnPlayerRequestMusicList(playerid, key_words[], bool:error);
forward OnPlayerPlayMusic(playerid, index);

public OnMusicSearchResults(Request:id, E_HTTP_STATUS:status, Node:node);
public OnMusicRequestLink(Request:id, E_HTTP_STATUS:status, Node:node);


hook OnGameModeInit() {
    MusicApiClient = RequestsClient(API_BASE_URL);
    if(!IsValidRequestsClient(MusicApiClient)) {
        printf("[yt_api.inc] ERRO FATAL: Falha ao inicializar MusicApiClient para URL: %s.", API_BASE_URL);
    }

    if(RequestToPlayerIdMap == Map:-1) {
        printf("[yt_api.inc] ERRO FATAL: Falha ao criar RequestToPlayerIdMap.");
    }
	return 1;
}

hook OnPlayerConnect(playerid) {
    __musicPlayerSearchOriginal[playerid][0] = EOS;
    __musicIndexCount[playerid] = 0;
    __musicPlayerSelectedMusicIndex[playerid] = -1;
    for(new i = 0; i < MAX_MUSIC_SEARCH_ITEMS; i++) {
		__musicPlayerDataID[playerid][i][0] = EOS;
		__musicPlayerDataArtist[playerid][i][0] = EOS;
		__musicPlayerDataName[playerid][i][0] = EOS;
		__musicPlayerDataDuration[playerid][i][0] = EOS;
	}

	return 1;
}

hook OnPlayerDisconnect(playerid, reason) {
    #pragma unused reason
    __musicPlayerSearchOriginal[playerid][0] = EOS;
	__musicIndexCount[playerid] = 0;
	__musicPlayerSelectedMusicIndex[playerid] = -1;
	for(new i = 0; i < MAX_MUSIC_SEARCH_ITEMS; i++) {
		__musicPlayerDataID[playerid][i][0] = EOS;
		__musicPlayerDataArtist[playerid][i][0] = EOS;
		__musicPlayerDataName[playerid][i][0] = EOS;
		__musicPlayerDataDuration[playerid][i][0] = EOS;
	}
	return 1;
}

stock MusicSearchByKey(playerid, const search_query[]) {
	if(!IsPlayerConnected(playerid)) return 0;
    if(strlen(search_query) < 1 || strlen(search_query) > MAX_MUSIC_SEARCH_LENGTH) return 0;
    if(!IsValidRequestsClient(MusicApiClient) || RequestToPlayerIdMap == Map:-1) {
        printf("[yt_api.inc] Cliente da API ou Mapa não inicializado.");
        return 0;
    }

	for(new i = 0; i < MAX_MUSIC_SEARCH_ITEMS; i++) {
		__musicPlayerDataID[playerid][i][0] = EOS;
		__musicPlayerDataArtist[playerid][i][0] = EOS;
		__musicPlayerDataName[playerid][i][0] = EOS;
		__musicPlayerDataDuration[playerid][i][0] = EOS;
	}
	__musicIndexCount[playerid] = 0;
	
	static encoded_q[MAX_API_PATH_LENGTH * 2];

    strurlencode(encoded_q, search_query);
    printf("not encoded: %s | encoded: %s", search_query, encoded_q);	
    new Request:req_id = RequestJSON(
        MusicApiClient,
        sprintf("/api/search?q=%s&limit=%d", encoded_q, MAX_MUSIC_SEARCH_ITEMS),
        HTTP_METHOD_GET,
        "OnMusicSearchResults",
        Node:-1,
        Headers:-1
    );

    if(!IsValidRequest(req_id)) {
        printf("[MusicSearch] Falha ao criar request para player %d. Path: %s", playerid, sprintf("/api/search?q=%s&limit=%d", encoded_q, MAX_MUSIC_SEARCH_ITEMS));
        CallLocalFunction("OnPlayerRequestMusicList", "isb", playerid, sprintf("%s", __musicPlayerSearchOriginal[playerid]), true);
        return 0;
    }
    
    MAP_insert_val_val(RequestToPlayerIdMap, _:req_id, playerid);
	return 1;
}

stock PlayMusic(playerid, index) {
	if(!IsPlayerConnected(playerid)) return 0;
    if(index < 0 || index >= __musicIndexCount[playerid]) return 0;
	if(!strlen(__musicPlayerDataID[playerid][index])) return 0;
    if(!IsValidRequestsClient(MusicApiClient) || RequestToPlayerIdMap == Map:-1) {
        printf("[yt_api.inc] Cliente da API ou Mapa não inicializado.");
        return 0;
    }
	
	__musicPlayerSelectedMusicIndex[playerid] = index;
	
	static api_path[MAX_API_PATH_LENGTH];
	format(api_path, sizeof api_path, "/api/download/%s", __musicPlayerDataID[playerid][index]);
	
    new Request:req_id = RequestJSON(
        MusicApiClient,
        api_path,
        HTTP_METHOD_GET,
        "OnMusicRequestLink",
        Node:-1,
        Headers:-1
    );

    if(!IsValidRequest(req_id)) {
        printf("[yt_api.inc] Falha ao criar request para player %d. Path: %s", playerid, api_path);
        CallLocalFunction("OnPlayerPlayMusic", "ii", playerid, -1);
        return 0;
    }
    
    printf("[yt_api.inc] Requesting link para player %d (video ID: %s)", playerid, __musicPlayerDataID[playerid][index]);
    MAP_insert_val_val(RequestToPlayerIdMap, _:req_id, playerid);
	return 1;
}


public OnMusicSearchResults(Request:id, E_HTTP_STATUS:status, Node:node) {
    new playerid = MAP_get_val_val(RequestToPlayerIdMap, _:id);


    if(!IsPlayerConnected(playerid)) {
        return 1;
    }

    new search_keywords_original[MAX_MUSIC_SEARCH_LENGTH + 1];
    strcat(search_keywords_original, __musicPlayerSearchOriginal[playerid], sizeof(search_keywords_original));

    __musicIndexCount[playerid] = 0;

	if(status == HTTP_STATUS_OK) {
        if(JsonNodeType(node) == JSON_NODE_ARRAY) {
            new array_length;
            JsonArrayLength(node, array_length);
            new count = 0;

            for(new i = 0; i < array_length && count < MAX_MUSIC_SEARCH_ITEMS; i++) {
                new Node:item_node;
                JsonArrayObject(node, i, item_node);

                if(JsonNodeType(item_node) == JSON_NODE_OBJECT) {
                    new full_title_buffer[MAX_MUSIC_ARTIST_LENGTH + MAX_MUSIC_NAME_LENGTH + 5];
                    
                    JsonGetString(item_node, "id", __musicPlayerDataID[playerid][count], MAX_MUSIC_ID_LENGTH);
                    JsonGetString(item_node, "title", full_title_buffer, sizeof(full_title_buffer));
                    JsonGetString(item_node, "duration", __musicPlayerDataDuration[playerid][count], MAX_MUSIC_DURATION_LENGTH);
                    
                    new separator_index = strfind(full_title_buffer, " - ");
                    if(separator_index != -1 && separator_index < (sizeof(full_title_buffer) - 3)) {
                        strmid(__musicPlayerDataArtist[playerid][count], full_title_buffer, 0, separator_index, MAX_MUSIC_ARTIST_LENGTH);
                        strmid(__musicPlayerDataName[playerid][count], full_title_buffer, separator_index + 3, strlen(full_title_buffer), MAX_MUSIC_NAME_LENGTH);
                    } else {
                        format(__musicPlayerDataArtist[playerid][count], MAX_MUSIC_ARTIST_LENGTH, "Desconhecido");
                        format(__musicPlayerDataName[playerid][count], MAX_MUSIC_NAME_LENGTH, "%s", full_title_buffer);
                    }
                    count++;
                }
            }
            __musicIndexCount[playerid] = count;
        } else {
            printf("[yt_api.inc] Resposta para player %d (%s) não é um array JSON válido.", playerid, search_keywords_original);
        }

        if(__musicIndexCount[playerid] > 0) {
		    CallLocalFunction("OnPlayerRequestMusicList", "isb", playerid, search_keywords_original, false);
        } else {
            CallLocalFunction("OnPlayerRequestMusicList", "isb", playerid, search_keywords_original, true);
        }
	} else {
        printf("[yt_api.inc] Erro HTTP %d para player %d (busca: %s).", _:status, playerid, search_keywords_original);
		CallLocalFunction("OnPlayerRequestMusicList", "isb", playerid, search_keywords_original, true);
	}
	return 1;
}

public OnMusicRequestLink(Request:id, E_HTTP_STATUS:status, Node:node) {
    new playerid = MAP_get_val_val(RequestToPlayerIdMap, _:id);

    if(!IsPlayerConnected(playerid)) return 1;

    new current_selected_index = __musicPlayerSelectedMusicIndex[playerid];

	if(status == HTTP_STATUS_OK) {
        if(JsonNodeType(node) == JSON_NODE_OBJECT) {
            static music_stream_url[MAX_PLAY_URL_LENGTH];
            music_stream_url[0] = EOS;
            JsonGetString(node, "playUrl", music_stream_url, sizeof(music_stream_url));

            if(strlen(music_stream_url) > 0) {
                PlayAudioStreamForPlayer(playerid, music_stream_url);
                CallLocalFunction("OnPlayerPlayMusic", "ii", playerid, current_selected_index);
            } else {
                printf("[yt_api.inc] Erro: 'playUrl' recebido vazio para player %d, índice %d.", playerid, current_selected_index);
                CallLocalFunction("OnPlayerPlayMusic", "ii", playerid, -1);
            }
        } else {
             printf("[yt_api.inc] Erro: Resposta JSON para link não é um objeto para player %d, índice %d.", playerid, current_selected_index);
             CallLocalFunction("OnPlayerPlayMusic", "ii", playerid, -1);
        }
	}
    else if(status == HTTP_STATUS_FORBIDDEN) {
        printf("[yt_api.inc] Não foi possível tocar músicas com restrição de idade para %d, índice %d.", playerid, current_selected_index);
    }

	else
	{
        printf("[yt_api.inc] Erro HTTP %d ao obter link para player %d, índice %d.", _:status, playerid, current_selected_index);
		CallLocalFunction("OnPlayerPlayMusic", "ii", playerid, -1);
	}

	return 1;
}


stock GetPlayerMusicID(playerid, index) {
	static value[MAX_MUSIC_ID_LENGTH]; value[0] = EOS;
	if(!IsPlayerConnected(playerid) || index < 0 || index >= __musicIndexCount[playerid]) return value;
	strcat(value, __musicPlayerDataID[playerid][index], MAX_MUSIC_ID_LENGTH);
	return value;
}
stock GetPlayerMusicArtist(playerid, index) {
	static value[MAX_MUSIC_ARTIST_LENGTH]; value[0] = EOS;
	if(!IsPlayerConnected(playerid) || index < 0 || index >= __musicIndexCount[playerid]) return value;
	strcat(value, __musicPlayerDataArtist[playerid][index], MAX_MUSIC_ARTIST_LENGTH);
	return value;
}
stock GetPlayerMusicName(playerid, index) {
	static value[MAX_MUSIC_NAME_LENGTH]; value[0] = EOS;
	if(!IsPlayerConnected(playerid) || index < 0 || index >= __musicIndexCount[playerid]) return value;
	strcat(value, __musicPlayerDataName[playerid][index], MAX_MUSIC_NAME_LENGTH);
	return value;
}
stock GetPlayerMusicDuration(playerid, index) {
	static value[MAX_MUSIC_DURATION_LENGTH]; value[0] = EOS;
	if(!IsPlayerConnected(playerid) || index < 0 || index >= __musicIndexCount[playerid]) return value;
	strcat(value, __musicPlayerDataDuration[playerid][index], MAX_MUSIC_DURATION_LENGTH);
	return value;
}
stock GetPlayerMusicPoolSize(playerid) {
	if(!IsPlayerConnected(playerid)) return 0;
	return __musicIndexCount[playerid];
}
stock GetPlayerCurrentSearch(playerid, dest[], len) {
    dest[0] = EOS;
    if(!IsPlayerConnected(playerid)) return "";
    strcat(dest, __musicPlayerSearchOriginal[playerid], len);
    return dest;
}