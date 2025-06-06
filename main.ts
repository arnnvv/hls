import Hls from "hls.js";

const videoElement = document.getElementById("hlsPlayer") as HTMLVideoElement;
const statusElement = document.getElementById("status") as HTMLParagraphElement;
const hlsStreamUrl = "http://localhost:8080/playlist.m3u8";

let hlsInstance: Hls | null = null;
let isDummyPlaylistDetected = false;
let retryTimeout: number | null = null;

function updateStatus(message: string) {
  if (statusElement) {
    statusElement.textContent = message;
  }
  console.log(`[HLS Viewer] ${message}`);
}

function initializePlayer() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }

  if (hlsInstance) {
    hlsInstance.destroy();
  }

  hlsInstance = new Hls({
    debug: true,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 5,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
  });

  updateStatus("Loading HLS stream...");
  hlsInstance.loadSource(hlsStreamUrl);
  hlsInstance.attachMedia(videoElement);

  hlsInstance.on(Hls.Events.MANIFEST_LOADED, (_, data) => {
    updateStatus("Manifest loaded. Checking stream type...");
    if (data.levels.length > 0) {
      const levelDetails = data.levels[0].details;
      if (
        levelDetails &&
        levelDetails.totalduration <= 2 &&
        levelDetails.fragments[0]?.url.endsWith("/dev/null") &&
        levelDetails.live === false
      ) {
        isDummyPlaylistDetected = true;
        updateStatus(
          "Placeholder playlist detected. Will retry for live stream shortly...",
        );
      } else {
        isDummyPlaylistDetected = false;
        updateStatus("Live manifest detected. Preparing playback...");
      }
    }
  });

  hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
    if (!isDummyPlaylistDetected) {
      updateStatus("Manifest parsed. Attempting to play...");
      videoElement.play().catch((error) => {
        updateStatus(`Autoplay prevented: ${error.message}. Click play icon.`);
      });
    }
  });

  hlsInstance.on(Hls.Events.ERROR, (_, data) => {
    const errorType = data.type;
    const errorDetails = data.details;
    const errorMessage = `HLS Error: ${errorType} - ${errorDetails}`;
    updateStatus(errorMessage);
    console.error(errorMessage, data);

    if (data.fatal) {
      if (
        isDummyPlaylistDetected &&
        (errorDetails === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
          errorDetails === Hls.ErrorDetails.LEVEL_LOAD_ERROR)
      ) {
        updateStatus("Error with placeholder. Retrying in 5s...");
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = window.setTimeout(initializePlayer, 5000);
        return;
      }

      switch (errorType) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          updateStatus("Network error. Attempting to recover...");
          if (
            errorDetails === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            errorDetails === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
            errorDetails === Hls.ErrorDetails.LEVEL_LOAD_ERROR
          ) {
            if (retryTimeout) clearTimeout(retryTimeout);
            retryTimeout = window.setTimeout(initializePlayer, 5000);
          } else {
            hlsInstance?.startLoad();
          }
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          updateStatus("Media error. Attempting to recover...");
          hlsInstance?.recoverMediaError();
          break;
        default:
          updateStatus("Unrecoverable HLS error. Player stopped.");
          hlsInstance?.destroy();
          hlsInstance = null;
          break;
      }
    }
  });

  videoElement.addEventListener("error", () => {
    const mediaError = videoElement.error;
    updateStatus(
      `Video Element Error: Code ${mediaError?.code} - ${mediaError?.message}`,
    );
    console.error("Video element error:", mediaError);
    // if (hlsInstance && (mediaError?.code === MediaError.MEDIA_ERR_NETWORK || mediaError?.code === MediaError.MEDIA_ERR_DECODE)) {
    //   if (retryTimeout) clearTimeout(retryTimeout);
    //   retryTimeout = window.setTimeout(initializePlayer, 5000);
    // }
  });

  videoElement.addEventListener("waiting", () => {
    updateStatus("Buffering...");
  });

  videoElement.addEventListener("playing", () => {
    if (!isDummyPlaylistDetected) {
      updateStatus("Playing live stream.");
    }
  });
}

if (videoElement && statusElement) {
  if (Hls.isSupported()) {
    updateStatus("HLS.js is supported. Initializing player...");
    initializePlayer();
  } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
    updateStatus(
      "Native HLS support detected (e.g., Safari). Playing directly...",
    );
    videoElement.src = hlsStreamUrl;
    videoElement.addEventListener("loadedmetadata", () => {
      updateStatus("Metadata loaded. Attempting to play...");
      videoElement.play().catch((error) => {
        updateStatus(
          `Native HLS Autoplay prevented: ${error.message}. Click play icon.`,
        );
      });
    });
    videoElement.addEventListener("error", () => {
      const mediaError = videoElement.error;
      updateStatus(
        `Native HLS Video Element Error: Code ${mediaError?.code} - ${mediaError?.message}`,
      );
    });
  } else {
    updateStatus("HLS is not supported in this browser.");
  }
} else {
  console.error("Could not find video player or status element in the DOM.");
}
