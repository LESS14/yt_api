      
# yt_api
 A complete API for playing YouTube music in SA-MP/open.mp

[<img src="https://i.imgur.com/ixZA1I8.png" alt="Demo Video">](https://youtu.be/ttRGhizjfzo)

**Based on the studies of Dr Editor (mustream) - [https://portalsamp.com/showthread.php?tid=3334](https://portalsamp.com/showthread.php?tid=3334)**

## Dependencies

*   [open.mp](https://www.open.mp) (or SA-MP)
*   [YSI_Coding/y_hooks](https://github.com/pawn-lang/YSI-Includes) (part of the YSI includes package)
*   [strlib](https://github.com/oscar-broman/strlib) (for functions like `sprintf` and `strurlencode`)
*   [pawn-requests](https://github.com/Southclaws/pawn-requests) (for making HTTP requests)
*   [pawn-map](https://github.com/BigETI/pawn-map) (for hashmaps)
*   [pawn-memory](https://github.com/BigETI/pawn-map) (for direct access to the Pawn heap - a `pawn-map` dependency)
*   **A backend API service** running and accessible by the SA-MP server. This include is a *client* for that API.

## Installation

1.  Ensure all dependencies listed above are installed on your server.
2.  Place the `yt_api.inc` file in the `pawno/include` folder (or your project's includes folder).
3.  Add `#include <yt_api>` at the top of your gamemode or filterscript.

# Warnings

> [!WARNING]
> In case of age restriction or other errors preventing playback, the API should return an appropriate HTTP status (e.g., HTTP_STATUS_FORBIDDEN (403)).

> [!WARNING]
> The functions **GetPlayerMusicID**, **GetPlayerMusicArtist**, **GetPlayerMusicName**, and **GetPlayerMusicDuration** return pointers to static strings. This means the returned value is overwritten on the next call to the same function. If you need to use the value persistently (e.g., in a loop or for multiple players simultaneously), copy the string to a local buffer immediately after the call, as shown in the callback examples.

## Configuration

The main configuration is the base URL of your backend API:

```pawn
#define API_BASE_URL        "http://127.0.0.1:9000"
```

Change http://127.0.0.1:9000 to the correct address and port where your backend API is running.

Other configurable constants (usually do not need to be changed):

MAX_MUSIC_SEARCH_ITEMS: Maximum number of search results to be returned.

MAX_MUSIC_SEARCH_LENGTH: Maximum length of the search string.

Other MAX_..._LENGTH constants define buffer sizes for music data.

Expected Backend API

This include expects the backend API to have the following endpoints:

Music Search:

Endpoint: GET {API_BASE_URL}/api/search?q={encoded_query}&limit={limit}

Expected Response (JSON Array):

      
```json
[
    {
        "id": "VIDEO_ID_1",
        "title": "Artist 1 - Song Name 1",
        "duration": "3:45"
    },
    {
        "id": "VIDEO_ID_2",
        "title": "Artist 2 - Song Name 2",
        "duration": "4:12"
    }
]
```

Getting the Stream Link:

Endpoint: GET {API_BASE_URL}/api/download/{video_id}

Expected Response (JSON Object):

```json
{
    "playUrl": "DIRECT_AUDIO_STREAM_URL"
}
```

`MusicSearchByKey(playerid, const search_query[])`

Initiates a music search for a player.

* playerid: The ID of the player requesting the search.

* search_query[]: The keywords for the search.

Returns: 1 if the search request was sent successfully, 0 on failure (e.g., player not connected, invalid query, API not initialized).

Callback: OnPlayerRequestMusicList will be called when the results are ready or an error occurs.

`PlayMusic(playerid, index)`

Requests the stream link and plays the selected song from the last search results list for a player.

* playerid: The ID of the player.

* index: The index of the song in the results list (0 to MAX_MUSIC_SEARCH_ITEMS - 1).

Returns: 1 if the request to get the link was sent successfully, 0 on failure (e.g., player not connected, invalid index, API not initialized).

Callback: OnPlayerPlayMusic will be called when the stream link is ready (or an error occurs) and the music starts playing (or fails).

`GetPlayerMusicID(playerid, index)`

Returns the ID of the music at the specified index from the player's last search.

* playerid: The ID of the player.

* index: The index of the music.

Returns: String with the music ID, or an empty string if invalid. Note: Returns a pointer to a static string; copy the value if you need it persistently or in loops.

`GetPlayerMusicArtist(playerid, index)`

Returns the artist name of the music at the specified index.

* playerid: The ID of the player.

* index: The index of the music.

Returns: String with the artist's name, or "Unknown" / empty string. Note: Returns a pointer to a static string.

`GetPlayerMusicName(playerid, index)`

Returns the name of the music at the specified index.

* playerid: The ID of the player.

* index: The index of the music.

Returns: String with the music name, or an empty string. Note: Returns a pointer to a static string.

`GetPlayerMusicDuration(playerid, index)`

Returns the duration of the music at the specified index.

* playerid: The ID of the player.

* index: The index of the music.

Returns: String with the music duration (e.g., "3:45"), or an empty string. Note: Returns a pointer to a static string.

`GetPlayerMusicPoolSize(playerid)`

Returns the number of music results available from the player's last search.

* playerid: The ID of the player.

Returns: The number of results.

`GetPlayerCurrentSearch(playerid, dest[], len)`

Copies the player's last original search string to dest.

* playerid: The ID of the player.

* dest[]: Destination array for the search string.

* len: Size of the dest array.

Returns: Pointer to dest. Empty string if no search or invalid player.

Callbacks (publics)

You need to implement these callbacks in your gamemode/filterscript.

`OnPlayerRequestMusicList(playerid, key_words[], bool:error)`

Called when music search results are available or if an error occurred during the search.

* playerid: The ID of the player who requested the search.

* key_words[]: The original keywords used in the search.

error: true if an error occurred while fetching the list, false if the results were obtained successfully.

Example Implementation:

      
```pawn
public OnPlayerRequestMusicList(playerid, key_words[], bool:error) {
    if(error) {
        SendClientMessage(playerid, 0xFF0000AA, "Error searching for music. Try again.");
        return 1;
    }

    new count = GetPlayerMusicPoolSize(playerid);
    if(count == 0) {
        SendClientMessage(playerid, 0xFFFF00AA, "No music found for your search.");
        return 1;
    }

    SendClientMessage(playerid, 0x00FF00AA, "Search results:");
    for(new i = 0; i < count; i++) {
        new artist[MAX_MUSIC_ARTIST_LENGTH], name[MAX_MUSIC_NAME_LENGTH], duration[MAX_MUSIC_DURATION_LENGTH];
        
        format(artist, sizeof(artist), "%s", GetPlayerMusicArtist(playerid, i));
        format(name, sizeof(name), "%s", GetPlayerMusicName(playerid, i));
        format(duration, sizeof(duration), "%s", GetPlayerMusicDuration(playerid, i));

        new msg[256];
        format(msg, sizeof(msg), "%d. [%s] %s - %s", i + 1, duration, artist, name);
        SendClientMessage(playerid, 0xFFFFFFAA, msg);
    }
    SendClientMessage(playerid, 0xCCCCCCAA, "Use /playmusic [number] to play.");
    return 1;
}
```


`forward OnPlayerPlayMusic(playerid, index)`

Called when a song starts playing for the player, or if an error occurred while trying to get the stream link or play.

* playerid: The ID of the player.

* index: The index of the music being played (from the last search list). Will be -1 if an error occurred obtaining the stream link or if it couldn't play (e.g., age restriction).


Example Implementation:

      
```pawn
public OnPlayerPlayMusic(playerid, index) {
    if(index == -1) {
        SendClientMessage(playerid, -1, "Error playing the selected music. It might be restricted or unavailable.");
        return 1;
    }

    new artist[MAX_MUSIC_ARTIST_LENGTH], name[MAX_MUSIC_NAME_LENGTH];
    
    format(artist, sizeof(artist), "%s", GetPlayerMusicArtist(playerid, index));
    format(name, sizeof(name), "%s", GetPlayerMusicName(playerid, index));

    new msg[256];
    format(msg, sizeof(msg), "Now playing: %s - %s", artist, name);
    SendClientMessage(playerid, 0x33CCFFAA, msg);
    return 1;
}
```


This include uses the requests library for asynchronous HTTP communication.

Error logs are printed to the server console (using printf) for initialization problems or request failures.

The include manages per-player data, such as the last search and results. This data is cleared when the player disconnects.