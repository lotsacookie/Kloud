var timer;
var request;
var failureTimer;
var interval = 1000;
var lastStatus = "";

var webSocketFactory = {
    connect: function(url) {

        var ws = new WebSocket(url);

        ws.addEventListener("open", e => {
            ws.close();
            window.location.replace(window.location.href);
        });

        ws.addEventListener("error", e => {
            if (e.target.readyState === 3) {
                setTimeout(() => this.connect(url), 1000);
            }
        });
    }
};

function abortRequest() {

    if (!request) {
        return false;
    }

    request.onreadystatechange = null;
    request.abort();
    request = null;

    return true;
}

function clearFailure() {

    if (!failureTimer) {
        return false;
    }

    clearTimeout(failureTimer);
    failureTimer = null;

    return true;
}

function connectionLost() {

    if (document.hidden || failureTimer) {
        return false;
    }

    failureTimer = setTimeout(function() {

        if (document.hidden) {
            failureTimer = null;
            return;
        }

        setStopped();
    }, interval * 3);

    return true;
}

function visibilityChanged() {

    clearFailure();

    if (document.hidden) {
        return false;
    }

    getInfo();
    return true;
}

function getInfo() {

    var url = "msg.html";

    try {
        abortRequest();

        if (window.XMLHttpRequest) {
            request = new XMLHttpRequest();
        } else {
            throw new Error("XMLHttpRequest not available!");
        }

        request.onreadystatechange = processInfo;
        request.open("GET", url, true);
        request.send();

    } catch (e) {
        setError("Error: " + e.message);
    }
}

function getURL() {

    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    var path = window.location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '');

    return protocol + "//" + window.location.host + path;
}

function redirect() {

    setInfo("Connecting to VNC", true);

    var wsUrl = getURL() + "/websockify";
    var webSocket = webSocketFactory.connect(wsUrl);

    return true;
}

function processInfo() {

    if (request.readyState != 4) {
        return true;
    }

    var response = request;
    request = null;

    var status = response.status;

    if (status == 502 || status == 503 || status == 504) {
        connectionLost();
        schedule();
        return true;
    }

    var msg = response.responseText;
    if (msg == null || msg.length == 0) {
        connectionLost();
        schedule();
        return false;
    }

    var notFound = (status == 404);

    if (status == 200) {
        if (msg.toLowerCase().indexOf("<html>") !== -1) {
            notFound = true;
        } else {
            clearFailure();
            rememberStatus(msg);
            setInfo(msg);
            schedule();
            return true;
        }
    }

    if (notFound) {
        clearFailure();
        redirect();
        return true;
    }

    setError("Error: Received statuscode " + status);
    return false;
}

function extractContent(s) {
    var span = document.createElement('span');
    span.innerHTML = s;
    return span.textContent || span.innerText;
};

function escapeContent(s) {
    var span = document.createElement('span');
    span.textContent = s;
    return span.innerHTML;
}

function rememberStatus(msg) {

    var text = extractContent(msg).trim();
    if (text.length == 0) {
        return false;
    }

    lastStatus = text;
    return true;
}

function parseSize(value, unit) {

    var powers = {
        "B": 0,
        "KB": 1,
        "KIB": 1,
        "MB": 2,
        "MIB": 2,
        "GB": 3,
        "GIB": 3,
        "TB": 4,
        "TIB": 4,
        "PB": 5,
        "PIB": 5,
        "EB": 6,
        "EIB": 6
    };

    unit = unit.toUpperCase();

    if (!Object.prototype.hasOwnProperty.call(powers, unit)) {
        return null;
    }

    var bytes = Number(value) * Math.pow(1024, powers[unit]);

    if (!Number.isFinite(bytes) || bytes < 0) {
        return null;
    }

    return bytes;
}

function estimateProgress(bytes) {

    var boundary = 512 * 1024 * 1024;
    var previousBoundary = 0;

    while (bytes > boundary) {
        previousBoundary = boundary;
        boundary *= 2;
    }

    if (previousBoundary === 0) {
        return Math.min(bytes / boundary * 100, 99.9);
    }

    var rangeProgress =
        (bytes - previousBoundary) /
        (boundary - previousBoundary);

    return Math.min(30 + Math.pow(rangeProgress, 2) * 70, 99.9);
}

function parseProgress(msg) {

    var container = document.createElement("div");
    container.innerHTML = msg;

    var walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT
    );

    var node;
    var lastNode = null;

    while ((node = walker.nextNode())) {
        if (node.nodeValue.trim() !== "") {
            lastNode = node;
        }
    }

    if (!lastNode) {
        return {
            message: msg,
            progress: null,
            size: null
        };
    }

    var percentMatch = lastNode.nodeValue.match(
        /\s+\((\d+(?:\.\d+)?)%\)\s*$/
    );

    if (percentMatch) {
        var progress = Number(percentMatch[1]);

        if (Number.isFinite(progress) && progress >= 0 && progress <= 100) {
            lastNode.nodeValue = lastNode.nodeValue.slice(
                0,
                percentMatch.index
            );

            return {
                message: container.innerHTML,
                progress: progress,
                size: null
            };
        }
    }

    var sizeMatch = lastNode.nodeValue.match(
        /\s+\((\d+(?:\.\d+)?)\s+([KMGTPE]?i?B)\)\s*$/i
    );

    if (sizeMatch) {
        var bytes = parseSize(sizeMatch[1], sizeMatch[2]);

        if (bytes != null) {
            var size = sizeMatch[1] + " " + sizeMatch[2];

            return {
                message: msg,
                progress: estimateProgress(bytes),
                size: size
            };
        }
    }

    return {
        message: msg,
        progress: null,
        size: null
    };
}

function setProgress(value, size) {

    var progress = document.getElementById("progress");
    var fill = document.getElementById("progress-fill");
    var percent = document.getElementById("progress-percent");
    var label = document.getElementById("progress-size");

    if (value == null) {
        progress.classList.add("indeterminate");
        progress.removeAttribute("title");
        progress.removeAttribute("aria-valuenow");
        progress.removeAttribute("aria-valuetext");
        fill.style.width = "";
        percent.textContent = "";
        label.textContent = "";
        return true;
    }

    progress.classList.remove("indeterminate");
    progress.setAttribute("aria-valuenow", value);
    fill.style.width = value + "%";

    if (size != null) {
        progress.title = size;
        progress.setAttribute("aria-valuetext", size);
        percent.textContent = "";
        label.textContent = size;
    } else {
        progress.title = value + "%";
        progress.removeAttribute("aria-valuetext");
        percent.textContent = value.toFixed(1) + "%";
        label.textContent = "";
    }

    return true;
}

function showProgress(visible) {

    document.getElementById("progress").hidden = !visible;
    document.getElementById("details").hidden = !visible;
    document.body.classList.toggle("error", !visible);

    return true;
}

function setInfo(msg, loading, error) {

    if (msg == null || msg.length == 0) {
        return false;
    }

    error = !!error;

    var parsed = parseProgress(msg);
    msg = parsed.message;

    if (error) {
        setProgress(null);
    } else {
        setProgress(parsed.progress, parsed.size);
    }

    showProgress(!error);

    var el = document.getElementById("info");

    if (el.innerText == msg || el.innerHTML == msg) {
        return true;
    }

    var p = "<p class=\"loading\">";
    loading = !!loading;
    if (loading) {
        msg = p + msg + "</p>";
    }

    if (msg.includes(p)) {
        if (el.innerHTML.includes(p)) {
            el.getElementsByClassName('loading')[0].textContent = extractContent(msg);
            return true;
        }
    }

    el.innerHTML = msg;
    return true;
}

function setError(text) {
    console.warn(text);
    return setInfo(text, false, true);
}

function setStopped() {

    var msg = "<span style=\"display:block\">The container has stopped.</span>";
    msg += "<span style=\"display:block; margin-top:1em; font-size:0.85em; font-weight:normal\">Check the container log for more details.</span>";

    if (lastStatus.length > 0) {
        msg += "<span style=\"display:block; margin-top:1em; font-size:0.75em; font-weight:normal; color:rgba(255,255,255,0.65)\">[ Last status: " + escapeContent(lastStatus) + " ]</span>";
    }

    return setError(msg);
}

function schedule() {

    clearTimeout(timer);
    timer = setTimeout(getInfo, interval);
}

function connect() {

    var wsUrl = getURL() + "/status";
    var ws = new WebSocket(wsUrl);

    ws.onopen = function(e) {
        clearFailure();
    };

    ws.onmessage = function(e) {

        clearFailure();

        var pos = e.data.indexOf(":");
        var cmd = e.data.substring(0, pos);
        var msg = e.data.substring(pos + 2);

        switch (cmd) {
            case "s":

                if (abortRequest()) {
                    schedule();
                }

                rememberStatus(msg);
                setInfo(msg);
                break;

            case "c":
                switch (msg) {
                    case "vnc":
                        abortRequest();
                        redirect();
                        break;
                    default:
                        console.warn("Unknown command: " + msg);
                        break;
                }
                break;

            case "e":

                if (abortRequest()) {
                    schedule();
                }

                rememberStatus(msg);
                setError(msg);
                break;

            default:
                console.warn("Unknown event: " + cmd);
                break;
        }
    };

    ws.onclose = function(e) {
        connectionLost();
        setTimeout(function() {
            connect();
        }, interval);
    };

    ws.onerror = function(e) {
        connectionLost();
        ws.close();
    };
}

document.addEventListener("visibilitychange", visibilityChanged);

rememberStatus(document.getElementById("info").innerHTML);

schedule();
connect();
