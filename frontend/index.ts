import { createPopper } from "@popperjs/core/lib/popper-lite.js";

const GOOD = "&#x2713";
const BAD = "&#x2717";
const UNKNOWN = "?";

const PING_SUCCESS = "success";
const PING_NO_RESPONSE_YET = "no response"; // noresponse in css
const PING_NO_CONNECTION = "no connection"; // noconnection in css
const PING_TIMEOUT = "timeout";

const MILLIS_PER_SECOND = 1000;

const PERIODIC_TEST_PERIOD = 30 * MILLIS_PER_SECOND;
const WEBRTC_RETRY_PERIOD = 10 * MILLIS_PER_SECOND;
const RECONNECT_WEBRTC_PERIOD = 30 * 60 * MILLIS_PER_SECOND;

const TIMEOUTS_BEFORE_RECONNECT = 5;
const PING_TIMEOUT_MS = 5000;
const HIGH_LATENCY_MARK_MS = 500;

// == State ==

const tests: { [key: string]: string } = {
  http: UNKNOWN,
  dns: UNKNOWN,
  browser: UNKNOWN,
  webRtc: UNKNOWN,
  // We assume the internet is working at first since we do not allow the
  // browser to cache this page
  initialLoad: GOOD,
};

// timestamp in millis of next periodic test
let nextPeriodicTests = Date.now();

let rtcPeer: RTCPeerConnection | null = null;
let rtcChannel: RTCDataChannel | null = null;

// The timestamp of the first ping we sent to this peer
let millisOfFirstPingToPeer: number | null = null;
// The current server's own reported human description of location
let rtcPeerLocation: string | null = null;
// List of all peer connection locations we have connected to and when we connected to
// them (in *seconds* since first ping).
const rtcPeerLocations: [string, number][] = [];

// Timestamp of the last time we attempted to connect
let lastRtcConnectAttempt = 0;
let timeoutsWithoutSuccess = 0;

// index 0 in pingResults is this timestamp
// each additional is the next
let secondOfFirstPing = 0;
// each entry is the latency of the ping or a string if an error
const pingResults: (string | number)[] = [];

// Used to ensure the Last RTT is not overwritten with an older response.
let lastSuccessPingMillis: number | null = null;
// Used to compute average round trip time and packet loss.
let totalRoundTripTime: number = 0;
let numSuccessfulPings: number = 0;
let numTimeoutPings: number = 0;

// Holding this to allow for background timers more frequently than once per
// second which prevents gaps in ping requests on at least Firefox
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioContext = (() => {
  if (AudioContext) {
    return new AudioContext();
  }
})();

// The second div that is currently or most recently display the tooltip
let tooltipTarget: EventTarget | null = null;

function getLastPingTime() {
  return secondOfFirstPing + pingResults.length;
}

// Careful, may return a negative number
function timeSinceFirstPing(sec: number) {
  return sec - secondOfFirstPing;
}

function getPingResultForSecond(sec: number) {
  const timeSinceFirst = timeSinceFirstPing(sec);
  if (timeSinceFirst < 0) {
    return "Before first ping";
  }
  return pingResults[timeSinceFirstPing(sec)];
}

function getPingPeerLocationForSecond(pingSec: number) {
  for (let idx = rtcPeerLocations.length - 1; idx >= 0; idx--) {
    const [location_description, locSec] = rtcPeerLocations[idx];
    if (locSec <= pingSec) {
      return location_description;
    }
  }
  return "Unknown";
}

const tooltip: HTMLElement = document.getElementById("tooltip")!;
function showTooltip(evt: Event) {
  const div = evt.target as Element;
  tooltipTarget = div;
  setTimeout(() => {
    if (tooltipTarget !== div) {
      // We moved away before the timeout
      return;
    }
    const secInMinute = parseInt(div.getAttribute("data-sec")!);
    const min = parseInt(div.parentElement!.getAttribute("data-minute")!);
    const timestampSec = min * 60 + secInMinute;
    const result = getPingResultForSecond(timestampSec);
    let text =
      new Date(timestampSec * MILLIS_PER_SECOND).toLocaleTimeString() + "<br>";
    if (typeof result === "number") {
      text += "Success: " + result.toFixed(1) + " ms<br>";
      text += "From: " + getPingPeerLocationForSecond(timestampSec);
    } else if (result === PING_NO_CONNECTION) {
      text += "Establishing a connection...";
    } else if (result === PING_NO_RESPONSE_YET) {
      text += "Waiting for response...";
    } else if (result === PING_TIMEOUT) {
      text += "Timed out waiting for response";
    } else {
      // Future second
      return;
    }
    tooltip.innerHTML = text;
    createPopper(div, tooltip);
    tooltip.setAttribute("data-show", "");
  }, 40);
}

function hideTooltip() {
  tooltipTarget = null;
  tooltip.removeAttribute("data-show");
}

function createNewPingingRow(sec: number) {
  const row = document.createElement("div");
  row.classList.add("row");
  const date = new Date(sec * MILLIS_PER_SECOND);
  const toPaddedStr = (x: number) => x.toString().padStart(2, "0");

  const minuteLabel = document.createElement("div");
  minuteLabel.classList.add("minuteLabel");
  minuteLabel.textContent =
    toPaddedStr(date.getHours()) + ":" + toPaddedStr(date.getMinutes());
  row.append(minuteLabel);
  for (let i = 0; i < 60; i++) {
    const sec = document.createElement("div");
    sec.classList.add("sec");
    sec.classList.add("future");
    sec.setAttribute("data-sec", String(i));
    const showEvents = ["mouseenter", "focus"];
    showEvents.forEach((event) => {
      sec.addEventListener(event, showTooltip);
    });

    const hideEvents = ["mouseleave", "blur"];
    hideEvents.forEach((event) => {
      sec.addEventListener(event, hideTooltip);
    });

    row.append(sec);
  }

  const chart = document.getElementById("pingChart")!;
  chart.prepend(row);

  return row;
}

function setPingResultForSecond(
  sentMillis: number,
  result: string,
  nowMillis = Date.now()
) {
  const elapsed = nowMillis - sentMillis;
  const sec = millisToWholeSec(sentMillis);
  if (secondOfFirstPing === 0) {
    secondOfFirstPing = sec;
  }
  if (result !== PING_NO_RESPONSE_YET) {
    log(
      "ping at",
      new Date(sentMillis).toISOString(),
      "had result",
      result,
      "in",
      elapsed + "ms"
    );
  }
  let toSave: string | number = result;
  if (result === PING_SUCCESS) {
    toSave = elapsed;
  }
  const previousResult = pingResults[timeSinceFirstPing(sec)];
  pingResults[timeSinceFirstPing(sec)] = toSave;
  // POSIX Unix timestamp days are guaranteed to be 86400.
  const minutesSinceEpoch = Math.floor(sec / 60);
  const id = "minute" + minutesSinceEpoch;
  let row = document.getElementById(id);
  if (row === null) {
    row = createNewPingingRow(sec);
    row.id = id;
    row.setAttribute("data-minute", String(minutesSinceEpoch));
  }
  const block = row.querySelector("[data-sec='" + (sec % 60) + "']")!;
  if (
    block.classList.contains("future") ||
    block.classList.contains("noresponse")
  ) {
    block.classList.remove("future");
    block.classList.remove("noresponse");
    block.classList.add(result.replace(/ /gi, ""));
  }

  if (result == PING_SUCCESS) {
    const latencyLine = document.createElement("div");
    latencyLine.classList.add("latencyLine");
    const percent = Math.min(Math.max(elapsed / HIGH_LATENCY_MARK_MS, 0), 1.0);
    // We hard code the height in CSS to be 3em.
    const marginTop = (1 - percent) * 3;
    latencyLine.style.marginTop = "calc(" + marginTop + "em - 2px)";
    block.appendChild(latencyLine);
  }

  if (result == PING_SUCCESS) {
    if (previousResult === PING_TIMEOUT) {
      // This is a late result. Undo the earlier timeout count.
      if (numTimeoutPings > 0) {
        numTimeoutPings++;
      }
    }
    updatePingStatsOnSuccess(sentMillis, nowMillis);
  } else if (result == PING_TIMEOUT) {
    updatePingStatsOnTimeout();
  }

  // update summary
  let recentSuccess = false;
  for (
    let i = Math.max(0, pingResults.length - 3);
    i < pingResults.length;
    i++
  ) {
    if (typeof pingResults[i] === "number") {
      recentSuccess = true;
      break;
    }
  }
  // Do not count a failure unless we have attempted a few times.
  if (recentSuccess || pingResults.length > 5) {
    updateStatus("webRtc", recentSuccess ? GOOD : BAD);
  }
}

const lastRoundTripTimeSpan: HTMLElement = document.getElementById("lastRTT")!;
const averageRoundTripTimeSpan: HTMLElement =
  document.getElementById("avgRTT")!;

function updatePingStatsOnSuccess(sentMillis: number, receivedMillis: number) {
  let rtt = receivedMillis - sentMillis;
  if (sentMillis > receivedMillis) {
    // Or should we skip counting this?
    rtt = 0;
  }
  totalRoundTripTime += rtt;
  numSuccessfulPings++;
  if (!lastSuccessPingMillis || sentMillis >= lastSuccessPingMillis) {
    lastRoundTripTimeSpan.innerHTML = Math.round(rtt) + " ms";
    lastSuccessPingMillis = sentMillis;
  }

  const avgRTT = Math.round(totalRoundTripTime / numSuccessfulPings);
  averageRoundTripTimeSpan.innerHTML = avgRTT + " ms";
  updatePacketLossSpan();
}

function updatePingStatsOnTimeout() {
  numTimeoutPings++;
  updatePacketLossSpan();
}

const packetLossSpan: HTMLElement = document.getElementById("packetLoss")!;
function updatePacketLossSpan() {
  const total = numSuccessfulPings + numTimeoutPings;
  if (total == 0) {
    return;
  }
  const percent = Math.round((numTimeoutPings / total) * 100);
  packetLossSpan.innerHTML = String(percent) + "%";
}

function log(this: any, ...varargs: any[]) {
  Function.prototype.bind.call(console.log, console).apply(this, varargs);
}

function changeSummaryText(state: string) {
  let newText;
  if (state === "on") {
    newText = "Your internet is <strong>online</strong>";
  } else if (state === "off") {
    newText = "Your internet is <strong>offline</strong>";
  } else if (state === "unknown") {
    newText = "Your internet is likely <strong>experiencing issues</strong>";
  } else {
    newText = "Internal error on pinging. Please report";
    console.error("This is a bug. Please report.");
  }
  const summaryText = document.getElementById("summaryText")!;
  summaryText.innerHTML = newText;
}

function updateStatus(which: string, newState: string) {
  if (tests[which] === newState) {
    return;
  }
  tests[which] = newState;
  document.getElementById(which + "Status")!.innerHTML = tests[which];

  let good = 0;
  let bad = 0;

  const check = (name: string) => {
    const s = tests[name];
    if (s == GOOD) {
      good++;
    } else if (s == BAD) {
      bad++;
    }
  };

  check("http");
  check("dns");
  check("webRtc");

  if (good > 0 && bad > 0) {
    changeSummaryText("unknown");
  } else if (good > 0) {
    changeSummaryText("on");
  } else if (bad > 0) {
    changeSummaryText("off");
  } else if (
    secondOfFirstPing != 0 &&
    timeSinceFirstPing(millisToWholeSec(Date.now())) >
      millisToWholeSec(PING_TIMEOUT_MS)
  ) {
    // Do not set to unknown for the first few seconds
    changeSummaryText("unknown");
  }
}

function updateBrowserOnlineStatus() {
  log("browser check reports ", navigator.onLine ? "online" : "offline");
  updateStatus("browser", navigator.onLine ? GOOD : BAD);
  runPeriodicTests();
}
window.addEventListener("online", updateBrowserOnlineStatus);
window.addEventListener("offline", updateBrowserOnlineStatus);
updateBrowserOnlineStatus();

async function testHttpOrDns(testName: string) {
  console.assert(testName == "dns" || testName == "http");
  const isHttpTest = testName == "http";
  const randomNumber = Math.round(Math.random() * 10000000);

  const startTime = Date.now();

  let pong;
  if (isHttpTest) {
    pong = fetch("/api/ping", {
      method: "POST",
      body: randomNumber.toString(),
      cache: "no-store",
    });
  } else {
    pong = fetch(
      "https://" + randomNumber + "dns-check.pinging.net/api/dns-check",
      {
        method: "GET",
        cache: "no-store",
      }
    );
  }

  try {
    const body = await (await pong).text();
    if (body !== randomNumber.toString()) {
      throw "Returned body not expected";
    }
    const duration = Date.now() - startTime;
    log(
      testName.toUpperCase(),
      "test completed successfully in",
      duration + "ms"
    );
    updateStatus(testName, GOOD);
  } catch (error) {
    const duration = Date.now() - startTime;
    log(testName.toUpperCase(), "test FAILED in", duration + "ms");
    console.error(error);
    updateStatus(testName, BAD);
  }
}

function runPeriodicTests() {
  updateStatus("http", UNKNOWN);
  updateStatus("dns", UNKNOWN);
  testHttpOrDns("http");
  testHttpOrDns("dns");
  if (nextPeriodicTests <= Date.now()) {
    nextPeriodicTests = Date.now() + PERIODIC_TEST_PERIOD;
  }
}

function runPeriodicTestsIfNecessaryAndUpdateTimer(nowMillis: number) {
  if (nowMillis >= nextPeriodicTests) {
    runPeriodicTests();
  }
  const secondsLeft = Math.ceil((nextPeriodicTests - nowMillis) / 1000);
  const span = document.getElementById("timeUntilNextPeriodicTests")!;
  if (span.textContent != String(secondsLeft)) {
    span.textContent = String(secondsLeft);
  }
}

async function setupRtc() {
  if (lastRtcConnectAttempt + WEBRTC_RETRY_PERIOD > Date.now()) {
    // Do not retry too quickly.
    return;
  }
  if (rtcChannel) {
    rtcChannel.close();
  }
  if (rtcPeer) {
    rtcPeer.close();
  }
  if (!RTCPeerConnection) {
    log("No RTCPeerConnection");
    document.getElementById("no-webrtc").style.display = "initial";
    return;
  }
  log("Attempting to connect via WebRTC");
  rtcPeer = new RTCPeerConnection();
  rtcPeerLocation = null;
  millisOfFirstPingToPeer = null;
  rtcChannel = rtcPeer.createDataChannel("webudp", {
    ordered: false,
    maxRetransmits: 0,
  });
  lastRtcConnectAttempt = Date.now();
  rtcChannel.binaryType = "arraybuffer";
  rtcChannel.onerror = (evt) => {
    log("Failed to establish WebRTC channel");
  };
  rtcChannel.onmessage = function (evt) {
    onPingResponse(evt);
  };
  const offer = await rtcPeer.createOffer();
  await rtcPeer.setLocalDescription(offer);
  const response = await fetch(
    "/new_rtc_session?num_successful=" +
      numSuccessfulPings.toString() +
      "&num_timeout=" +
      numTimeoutPings.toString(),
    {
      method: "POST",
      body: rtcPeer.localDescription!.sdp,
    }
  );
  const resp_json = await response.json();
  await rtcPeer.setRemoteDescription(
    new RTCSessionDescription(resp_json.answer)
  );
  var candidate = new RTCIceCandidate(resp_json.candidate);
  await rtcPeer.addIceCandidate(candidate);
}
setupRtc();

function millisToWholeSec(millis: number) {
  return Math.floor(millis / MILLIS_PER_SECOND);
}

function sendPing(nowMillis: number) {
  if (!rtcChannel || rtcChannel.readyState !== "open") {
    setPingResultForSecond(nowMillis, PING_NO_CONNECTION);
    setupRtc();
    return;
  }
  // We grab a new timestamp to keep the ping latency as accurate as we can from
  // JS.
  let data = "";
  if (!rtcPeerLocation) {
    data += "LOC?\n";
  }
  const now = Date.now();
  data += String(now);
  rtcChannel.send(data);
  if (millisOfFirstPingToPeer === null) {
    millisOfFirstPingToPeer = now;
  }
  // Send before setting NO_RESPONSE_YET since setPingResultForSecond might be
  // slow if it has to add a new row.
  setPingResultForSecond(nowMillis, PING_NO_RESPONSE_YET);
  // TODO it would be nice to not use a timeout here since the page might be in
  // the background and it seems we only get 1 timer per second. Or maybe we
  // should cancel the timer.
  setTimeout(() => {
    if (
      getPingResultForSecond(millisToWholeSec(nowMillis)) ===
      PING_NO_RESPONSE_YET
    ) {
      setPingResultForSecond(nowMillis, PING_TIMEOUT);
      timeoutsWithoutSuccess++;
      if (timeoutsWithoutSuccess >= TIMEOUTS_BEFORE_RECONNECT) {
        setupRtc();
      }
    }
  }, PING_TIMEOUT_MS);
}

// Attempt to use an event provided timestamp to get a timestamp that is closer
// to when we received the response packet.
function getEventTimestamp(evt: Event, nowMillis: number, sentMillis: number) {
  if (!evt.timeStamp || !performance.timeOrigin) {
    console.debug("No event time");
    return nowMillis;
  }
  const eventStamp = performance.timeOrigin + evt.timeStamp;
  // The event stamp can be rounded for privacy so only use it if it is older
  // than the timestamp we grabbed.
  if (eventStamp > nowMillis) {
    console.debug(
      "Event time in the future",
      sentMillis,
      eventStamp,
      nowMillis
    );
    return nowMillis;
  }
  // It also seems to be wrong in some browsers (Firefox on Android) where it is
  // an hour behind so only use it if it isn't before the timestamp we sent the
  // request.
  if (eventStamp < sentMillis) {
    console.debug(
      "Event time too far in past",
      sentMillis,
      eventStamp,
      nowMillis
    );
    return nowMillis;
  }
  return eventStamp;
}

function onPingResponse(evt: MessageEvent) {
  // Get our timestamp as early as possible to reduce latency calculation error
  const nowMillis = Date.now();
  const lines: [string] = evt.data.split("\n");
  // Last line is the timestamp we sent in the request.
  const sentMillis = parseInt(lines.pop()!);
  // The other lines are metadata
  for (const line of lines) {
    // Currently the only known possibility is LOC which is the server location
    if (line.startsWith("LOC:\t")) {
      const newRtcPeerLocation = line.split(":\t")[1];
      if (rtcPeerLocation === null) {
        rtcPeerLocation = newRtcPeerLocation;
        if (
          rtcPeerLocations.length == 0 ||
          rtcPeerLocations[rtcPeerLocations.length - 1][0] != rtcPeerLocation
        ) {
          rtcPeerLocations.push([
            rtcPeerLocation,
            millisToWholeSec(millisOfFirstPingToPeer!),
          ]);
        }
        const pingLocationSpan = document.getElementById("pingLocation")!;
        pingLocationSpan.innerHTML = rtcPeerLocation;
      } else if (newRtcPeerLocation != rtcPeerLocation) {
        console.error(
          "rtcPeerLocation does not match existing:",
          newRtcPeerLocation,
          rtcPeerLocation
        );
      }
    }
  }
  const receivedMillis = getEventTimestamp(evt, nowMillis, sentMillis);
  timeoutsWithoutSuccess = 0;
  setPingResultForSecond(sentMillis, PING_SUCCESS, receivedMillis);
  if (lastRtcConnectAttempt + RECONNECT_WEBRTC_PERIOD <= Date.now()) {
    log(
      "Reconnecting WebRTC connection in case the server connection info has updated."
    );
    setupRtc();
  }
}

function sendPingIfNecessary(nowMillis: number) {
  if (millisToWholeSec(nowMillis) >= getLastPingTime()) {
    sendPing(nowMillis);
  }
}

function onTimer() {
  let nowMillis = Date.now();
  runPeriodicTestsIfNecessaryAndUpdateTimer(nowMillis);
  sendPingIfNecessary(nowMillis);
  nowMillis = Date.now();
  const waitMillis = 1005 - (nowMillis % 1000);
  window.setTimeout(onTimer, waitMillis);
}
onTimer();
