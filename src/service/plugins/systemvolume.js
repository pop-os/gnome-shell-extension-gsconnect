'use strict';

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;

const PluginsBase = imports.service.plugins.base;


var Metadata = {
    summary: _('System Volume'),
    description: _('Control system volume and input levels'),
    id: 'org.gnome.Shell.Extensions.GSConnect.Plugin.SystemVolume',
    incomingCapabilities: ['kdeconnect.systemvolume.request'],
    outgoingCapabilities: ['kdeconnect.systemvolume'],
    actions: {}
};


/**
 * SystemVolume Plugin
 * https://github.com/KDE/kdeconnect-kde/tree/master/plugins/systemvolume
 * https://github.com/KDE/kdeconnect-android/tree/master/src/org/kde/kdeconnect/Plugins/SystemvolumePlugin/
 */
var Plugin = GObject.registerClass({
    GTypeName: 'GSConnectSystemVolumePlugin'
}, class Plugin extends PluginsBase.Plugin {

    _init(device) {
        super._init(device, 'systemvolume');

        // Cache stream properties
        this._cache = new WeakMap();

        // Connect to the mixer
        this._streamChangedId = this.service.mixer.connect(
            'stream-changed',
            this.sendSink.bind(this)
        );

        this._outputAddedId = this.service.mixer.connect(
            'output-added',
            this.sendSinkList.bind(this)
        );

        this._outputRemovedId = this.service.mixer.connect(
            'output-removed',
            this.sendSinkList.bind(this)
        );
    }

    handlePacket(packet) {
        switch (true) {
            case packet.body.hasOwnProperty('requestSinks'):
                this.sendSinkList();
                break;

            case packet.body.hasOwnProperty('name'):
                this.changeSink(packet);
                break;
        }
    }

    connected() {
        this.sendSinkList();
    }

    /**
     * Handle a request to change an output
     */
    changeSink(packet) {
        let stream;

        for (let sink of this.service.mixer.get_sinks()) {
            if (sink.name === packet.body.name) {
                stream = sink;
                break;
            }
        }

        // No sink with the given name
        if (stream === undefined) {
            this.sendSinkList();
            return;
        }

        // Get a cache and store volume and mute states if changed
        let cache = this._cache.get(stream) || [null, null, null];

        if (packet.body.hasOwnProperty('muted')) {
            cache[1] = packet.body.muted;
            this._cache.set(stream, cache);
            stream.change_is_muted(packet.body.muted);
        }

        if (packet.body.hasOwnProperty('volume')) {
            cache[0] = packet.body.volume;
            this._cache.set(stream, cache);
            stream.volume = packet.body.volume;
            stream.push_volume();
        }
    }

    /**
     * Send the state of a local sink
     *
     * @param {Gvc.MixerControl} mixer - The mixer that owns the stream
     * @param {Number} id - The Id of the stream that changed
     */
    sendSink(mixer, id) {
        let stream = this.service.mixer.lookup_stream_id(id);

        // Check if we've already sent these details
        let cache = this._cache.get(stream) || [null, null, null];

        switch (true) {
            // If the port (we show in the description) has changed we have to
            // send the whole list to show the change
            case (cache[2] != stream.get_port().human_port):
                this.sendSinkList();
                return;

            // If only volume and/or mute are set, we can send a single update
            case (cache[0] != stream.volume):
            case (cache[1] != stream.is_muted):
                this._cache.set(stream, [
                    stream.volume,
                    stream.is_muted,
                    stream.get_port().human_port
                ]);
                break;

            // Bail if nothing relevant has changed
            default:
                return;
        }

        // Send the stream update
        this.device.sendPacket({
            type: 'kdeconnect.systemvolume',
            body: {
                name: stream.name,
                volume: stream.volume,
                muted: stream.is_muted
            }
        });
    }

    /**
     * Send a list of local sinks
     */
    sendSinkList() {
        let sinkList = this.service.mixer.get_sinks().map(sink => {
            // Cache the sink state
            this._cache.set(sink, [
                sink.volume,
                sink.is_muted,
                sink.get_port().human_port
            ]);

            // return a sinkList entry
            return {
                name: sink.name,
                description: `${sink.get_port().human_port} (${sink.description})`,
                muted: sink.is_muted,
                volume: sink.volume,
                maxVolume: this.service.mixer.get_vol_max_norm()
            };
        });

        // Send the sinkList
        this.device.sendPacket({
            id: 0,
            type: 'kdeconnect.systemvolume',
            body: {
                sinkList: sinkList
            }
        });
    }

    destroy() {
        this.service.mixer.disconnect(this._streamChangedId);
        this.service.mixer.disconnect(this._outputAddedId);
        this.service.mixer.disconnect(this._outputRemovedId);

        super.destroy();
    }
});
