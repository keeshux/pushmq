//
// Copyright (c) 2011, Davide De Rosa
// All rights reserved.
//
// This code is distributed under the terms and conditions of the BSD license.
//
// Redistribution and use in source and binary forms, with or without modification,
// are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
// list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice,
// this list of conditions and the following disclaimer in the documentation and/or
// other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
// ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
//  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
// ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//

/**
 * @constructor
 */
function PushMQ(settings, onPublish) {
    this.connected = true;

    if (settings) {
        this.settings = settings;
    } else {
        this.settings = {};
    }

    // default parameters
    if (this.settings.pubUrl === undefined) {
        this.settings.pubUrl = '/publish?id=$1';
    }
    if (this.settings.subUrl === undefined) {
        this.settings.subUrl = '/activity?id=$1';
    }
    if (this.settings.sendTimeout === undefined) {
        this.settings.sendTimeout = 5000;
    }
    if (this.settings.sendRetry === undefined) {
        this.settings.sendRetry = 3000;
    }
    if (this.settings.pollTimeout === undefined) {
        this.settings.pollTimeout = 60000;
    }
    if (this.settings.pollDelay === undefined) {
        this.settings.pollDelay = 1000;
    }
    if (this.settings.pollRetry === undefined) {
        this.settings.pollRetry = 5000;
    }
    if (this.settings.debug === undefined) {
        this.settings.debug = false;
    }

    // published message callback
    this.onPublish = onPublish; // AJAX thread
}

// FIXME: message sequence not guaranteed (retry with same headers?)
PushMQ.prototype.publish = function(channel, msg) {
    var _this = this;
    var republish = function() { // closure for setTimeout()
        return _this.publish(channel, msg);
    };

    // publisher REST service
    $.ajax({
        type: 'POST',
        url: this.settings.pubUrl.replace('$1', channel),
        data: msg,
        dataType: 'text',
        contentType: 'text/plain',
        timeout: this.settings.sendTimeout,
        success: function(data, textStatus, xhr) {
            if (_this.settings.debug) {
                //console.error('<  "%s": "%s" (%s)', channel, msg, data);
                console.error('<  "%s": "%s"', channel, msg);
            }
        },
        error: function(xhr, textStatus, error) {

            // only retry if connected and (sendRetry > 0)
            if (_this.connected) {
                if (_this.settings.debug) {
                    console.error('<! "%s": %d %s', channel, xhr.status, error);
                }
                if (_this.settings.sendRetry > 0) {
                    setTimeout(republish, _this.settings.sendRetry);
                }
            }
        }
    });
};

PushMQ.prototype.subscribe = function(channel) {
    if (this.settings.debug) {
        console.error('@  "%s"', channel);
    }
    this._longPoll(channel, null, null);
};

PushMQ.prototype._longPoll = function(channel, lastMod, etag) {
    var _this = this;

    var headers = {
        'Cache-Control': 'max-age=0'
    };
    if (lastMod) {
        headers['If-Modified-Since'] = lastMod;
    }
    if (etag) {
        headers['If-None-Match'] = etag;
    }

    // subscriber REST service
    $.ajax({
        type: 'GET',
        url: this.settings.subUrl.replace('$1', channel),
        dataType: 'text',
        contentType: 'text/plain',
        timeout: this.settings.pollTimeout,
        cache: false, // IMPORTANT!
        ifModified: true, // IMPORTANT!
        headers: headers,
        success: function(data, textStatus, xhr) {

            // only repoll if connected
            if (_this.connected) {
                if (_this.settings.debug) {
                    console.error('>  "%s": "%s"', channel, data);
                }

                // don't repoll on errors
                try {

                    // publish callback
                    _this.onPublish(channel, data);

                    // closure for setTimeout() with updated headers
                    var repoll = function() {
                        lastMod = xhr.getResponseHeader('Last-Modified');
                        etag = xhr.getResponseHeader('Etag');
                        return _this._longPoll(channel, lastMod, etag);
                    };

                    // repoll
                    setTimeout(repoll, _this.settings.pollDelay);
                } catch (e) {
                    console.error('PushMQ: onPublish() exception:', e);
                }
            } else {
                if (_this.settings.debug) {
                    console.error('>- "%s": "%s"', channel, data);
                }
            }
        },
        error: function(xhr, textStatus, error) {

            // only retry if connected
            if (_this.connected) {
                if (_this.settings.debug) {
                    console.error('>! "%s": %s %s', channel, xhr.status, error);
                }

                // closure for setTimeout() with ORIGINAL headers
                var repoll = function() {
                    return _this._longPoll(channel, lastMod, etag);
                };
                setTimeout(repoll, _this.settings.pollRetry);
            }
        }
    });
};

PushMQ.prototype.close = function(channel, doDelete) {
    this.connected = false;

    // also delete queue channel (optional)
    if (doDelete) {
        $.ajax({
            'type': 'DELETE',
            'url': this.settings.pubUrl.replace('$1', channel),
            'success': function(data, textStatus, xhr) {
            },
            'error': function(xhr, textStatus, error) {
            }
        });
    }
    if (this.settings.debug) {
        console.error('X  "%s"', channel);
    }
};

