# yt_api
 Uma API completa para tocar músicas do YouTube no SA-MP/open.mp

[<img src="https://i.imgur.com/22rmJ2o.png" alt="thumbnail">](https://youtu.be/ttRGhizjfzo)

**Baseado nos estudos de Dr Editor (mustream) - [https://portalsamp.com/showthread.php?tid=3334](https://portalsamp.com/showthread.php?tid=3334)**

## Dependências

*   [open.mp](https://www.open.mp) (ou SA-MP)
*   [YSI_Coding/y_hooks](https://github.com/pawn-lang/YSI-Includes) (parte do pacote de includes YSI)
*   [strlib](https://github.com/oscar-broman/strlib) (para funções como sprintf e strurlencode)
*   [pawn-requests](https://github.com/Southclaws/pawn-requests) (para fazer requisições HTTP)
*   [pawn-memory](https://github.com/BigETI/pawn-memory) (para acesso a memória do Pawn/hashmap)
*   **Um serviço de API backend** rodando e acessível pelo servidor SA-MP. Este include é um *cliente* para essa API.

## Instalação

1.  Certifique-se de que todas as dependências listadas acima estão instaladas em seu servidor.
2.  Coloque o arquivo `yt_api.inc` na pasta `pawno/include` (ou na pasta de includes do seu projeto).
3.  Adicione `#include <yt_api>` no topo do seu gamemode ou filterscript.

## Configuração

A principal configuração é a URL base da sua API backend:

```pawn
#define API_BASE_URL        "http://127.0.0.1:9000"
```

Altere http://127.0.0.1:9000 para o endereço e porta corretos onde sua API backend está rodando.

Outras constantes configuráveis (geralmente não precisam ser alteradas):

* MAX_MUSIC_SEARCH_ITEMS: Número máximo de resultados de busca a serem retornados.

* MAX_MUSIC_SEARCH_LENGTH: Comprimento máximo da string de busca.

* Outras constantes MAX_..._LENGTH definem tamanhos de buffer para dados de música.

API Backend Esperada

Este include espera que a API backend tenha os seguintes endpoints:

Pesquisa de Músicas:

Endpoint: GET {API_BASE_URL}/api/search?q={query_encodada}&limit={limite}

Resposta Esperada (JSON Array):
```json
[
    {
        "id": "VIDEO_ID_1",
        "title": "Artista 1 - Nome da Música 1",
        "duration": "3:45"
    },
    {
        "id": "VIDEO_ID_2",
        "title": "Artista 2 - Nome da Música 2",
        "duration": "4:12"
    }
]
```


Obtenção do Link de Stream:

Endpoint: GET {API_BASE_URL}/api/download/{video_id}

Resposta Esperada (JSON Object):

```json          
{
    "playUrl": "URL_DO_STREAM_DE_AUDIO_DIRETO"
}
```
        
> [!WARNING]
> Em caso de restrição de idade ou outro erro que impeça o play, a API deve retornar um status HTTP apropriado (ex: HTTP_STATUS_FORBIDDEN (403)).

# Funções

`MusicSearchByKey(playerid, const search_query[])`

Inicia uma pesquisa de músicas para um jogador.

* playerid: O ID do jogador que está solicitando a busca.

* search_query[]: As palavras-chave para a busca.
* Retorna: 1 se a requisição de busca foi enviada com sucesso, 0 em caso de falha (ex: jogador não conectado, query inválida, API não inicializada).
* Callback: OnPlayerRequestMusicList será chamada quando os resultados estiverem prontos ou ocorrer um erro.

`PlayMusic(playerid, index)`

Solicita o link de stream e toca a música selecionada da lista de resultados da última busca para um jogador.

* playerid: O ID do jogador.
* index: O índice da música na lista de resultados (0 a MAX_MUSIC_SEARCH_ITEMS - 1).
* Retorna: 1 se a requisição para obter o link foi enviada com sucesso, 0 em caso de falha (ex: jogador não conectado, índice inválido, API não inicializada).
* Callback: OnPlayerPlayMusic será chamada quando o link de stream estiver pronto (ou ocorrer um erro) e a música começar a tocar (ou falhar).

`GetPlayerMusicID(playerid, index)`

Retorna o ID da música no índice especificado da última busca do jogador.

* playerid: O ID do jogador.
* index: O índice da música.
* Retorna: String com o ID da música, ou string vazia se inválido. Nota: Retorna um ponteiro para uma string estática; copie o valor se precisar dele persistentemente ou em loops.

`GetPlayerMusicArtist(playerid, index)`

Retorna o nome do artista da música no índice especificado.

* playerid: O ID do jogador.
* index: O índice da música.
* Retorna: String com o nome do artista, ou "Desconhecido" / string vazia. Nota: Retorna um ponteiro para uma string estática.

`GetPlayerMusicName(playerid, index)`

Retorna o nome da música no índice especificado.

* playerid: O ID do jogador.
* index: O índice da música.

* Retorna: String com o nome da música, ou string vazia. Nota: Retorna um ponteiro para uma string estática.

`GetPlayerMusicDuration(playerid, index)`

Retorna a duração da música no índice especificado.

* playerid: O ID do jogador.
* index: O índice da música.
* Retorna: String com a duração da música (ex: "3:45"), ou string vazia. Nota: Retorna um ponteiro para uma string estática.

`GetPlayerMusicPoolSize(playerid)`

Retorna o número de resultados de música disponíveis da última busca do jogador.

* playerid: O ID do jogador.
* Retorna: O número de resultados.
`GetPlayerCurrentSearch(playerid, dest[], len)`

Copia a última string de busca original do jogador para dest.

* playerid: O ID do jogador.
* dest[]: Array de destino para a string de busca.
* len: Tamanho do array dest.
* Retorna: Ponteiro para dest. String vazia se não houver busca ou jogador inválido.

Callbacks (publics)

Você precisa implementar estas callbacks em seu gamemode/filterscript.

`OnPlayerRequestMusicList(playerid, key_words[], bool:error)`

Chamada quando os resultados da busca de música estão disponíveis ou se ocorreu um erro durante a busca.

* playerid: O ID do jogador que solicitou a busca.
* key_words[]: As palavras-chave originais usadas na busca.
* error: true se ocorreu um erro ao buscar a lista, false se os resultados foram obtidos com sucesso.

Exemplo de Implementação:

      
```pawn
public OnPlayerRequestMusicList(playerid, key_words[], bool:error) {
    if(error) {
        SendClientMessage(playerid, 0xFF0000AA, "Erro ao buscar músicas. Tente novamente.");
        return 1;
    }

    new count = GetPlayerMusicPoolSize(playerid);
    if(count == 0) {
        SendClientMessage(playerid, 0xFFFF00AA, "Nenhuma música encontrada para sua busca.");
        return 1;
    }

    SendClientMessage(playerid, 0x00FF00AA, "Resultados da busca:");
    for(new i = 0; i < count; i++) {
        new artist[MAX_MUSIC_ARTIST_LENGTH], name[MAX_MUSIC_NAME_LENGTH], duration[MAX_MUSIC_DURATION_LENGTH];
        
        format(artist, sizeof(artist), "%s", GetPlayerMusicArtist(playerid, i));
        format(name, sizeof(name), "%s", GetPlayerMusicName(playerid, i));
        format(duration, sizeof(duration), "%s", GetPlayerMusicDuration(playerid, i));

        new msg[256];
        format(msg, sizeof(msg), "%d. [%s] %s - %s", i + 1, duration, artist, name);
        SendClientMessage(playerid, 0xFFFFFFAA, msg);
    }
    SendClientMessage(playerid, 0xCCCCCCAA, "Use /playmusic [numero] para tocar.");
    return 1;
}
```

    

`forward OnPlayerPlayMusic(playerid, index);`

Chamada quando uma música começa a tocar para o jogador, ou se ocorreu um erro ao tentar obter o link de stream ou tocar.

* playerid: O ID do jogador.
* index: O índice da música que está sendo tocada (da última lista de busca). Será -1 se ocorreu um erro ao obter o link de stream ou se não foi possível tocar (ex: restrição de idade).

Exemplo de Implementação:

      
```pawn
public OnPlayerPlayMusic(playerid, index) {
    if(index == -1) {
        SendClientMessage(playerid, -1, "Erro ao tocar a música selecionada. Pode ser restrita ou indisponível.");
        return 1;
    }

    new artist[MAX_MUSIC_ARTIST_LENGTH], name[MAX_MUSIC_NAME_LENGTH];
    
    format(artist, sizeof(artist), "%s", GetPlayerMusicArtist(playerid, index));
    format(name, sizeof(name), "%s", GetPlayerMusicName(playerid, index));

    new msg[256];
    format(msg, sizeof(msg), "Tocando agora: %s - %s", artist, name);
    SendClientMessage(playerid, 0x33CCFFAA, msg);
    return 1;
}
```



Este include utiliza a biblioteca requests para comunicação HTTP assíncrona.

Logs de erro são impressos no console do servidor (usando printf) para problemas de inicialização ou falhas de requisição.

O include gerencia dados por jogador, como a última busca e os resultados. Esses dados são limpos quando o jogador se desconecta.

Lembre-se que a qualidade e disponibilidade das músicas dependem inteiramente da API backend que você está utilizando.

As funções **GetPlayerMusicID**, **GetPlayerMusicArtist**, **GetPlayerMusicName**, e **GetPlayerMusicDuration** retornam ponteiros para strings estáticas. Isso significa que o valor retornado é sobrescrito na próxima chamada à mesma função. Se você precisa usar o valor persistentemente (ex: em um loop ou para múltiplos jogadores ao mesmo tempo), copie a string para um buffer local imediatamente após a chamada, como mostrado nos exemplos de callback.
