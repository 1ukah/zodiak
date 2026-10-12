#define _GNU_SOURCE
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#include <stdatomic.h>
#include <pthread.h>
#include <signal.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

// One capture adapter mixes explicitly linked playback ports. Existing device
// links are untouched; no microphone or mixed device-monitor is ever linked.
#define RING_SIZE 32768u // < 200 ms of 48 kHz stereo S16LE
struct object {
    struct object *next;
    uint32_t id;
    bool node, client, port, allowed, informed;
    struct pw_properties *props;
    struct pw_proxy *proxy;
    struct spa_hook listener;
};
struct tap {
    struct tap *next;
    uint32_t output, input;
    struct pw_proxy *proxy;
    struct spa_hook listener;
};
struct capture {
    struct pw_main_loop *loop;
    struct pw_context *context;
    struct pw_core *core;
    struct pw_registry *registry;
    struct pw_stream *stream;
    struct spa_hook core_listener, registry_listener, stream_listener;
    struct object *objects;
    struct tap *taps;
    struct spa_source *timer;
    long owner;
    bool discord, probe, synced, ready;
    int sync_seq, result;
    atomic_bool stopping;
    atomic_uint read, write;
    uint8_t ring[RING_SIZE];
};
static struct capture c;

static void fail(const char *message) {
    fprintf(stderr, "error %s\n", message);
    c.result = 1;
    pw_main_loop_quit(c.loop);
}
static const char *get(struct object *o, const char *key) {
    const char *s = o ? pw_properties_get(o->props, key) : NULL;
    return s ? s : "";
}
static struct object *find(uint32_t id) {
    for (struct object *o = c.objects; o; o = o->next) if (o->id == id) return o;
    return NULL;
}
static bool named(const char *value, bool discord) {
    const char *name = strrchr(value, '/'); name = name ? name + 1 : value;
    if (!discord) return !strcasecmp(name, "zodiak") || !strcasecmp(name, "app.zodiak") || !strcasecmp(name, "zodiak-pipewire-audio");
    const char *names[] = { "discord", "discordcanary", "discordptb", "discorddevelopment", "com.discordapp.Discord", "com.discordapp.DiscordCanary", "com.discordapp.DiscordPTB", NULL };
    for (int i = 0; names[i]; i++) if (!strcasecmp(name, names[i])) return true;
    return false;
}
static bool process_excluded(long pid) {
    // Chromium's audio service may report a child PID rather than Electron's
    // main PID. Walk the process tree; never classify generic electron/chrome.
    for (int depth = 0; pid > 1 && depth < 64; depth++) {
        if (pid == c.owner || pid == getpid()) return true;
        char path[64], line[512]; long parent = 0;
        snprintf(path, sizeof(path), "/proc/%ld/status", pid);
        FILE *file = fopen(path, "r");
        if (!file) break;
        while (fgets(line, sizeof(line), file)) {
            if (!strncmp(line, "Name:\t", 6)) {
                line[strcspn(line, "\n")] = 0;
                if (named(line + 6, false) || (c.discord && named(line + 6, true))) { fclose(file); return true; }
            }
            if (!strncmp(line, "PPid:", 5)) parent = strtol(line + 5, NULL, 10);
        }
        fclose(file);
        snprintf(path, sizeof(path), "/proc/%ld/exe", pid);
        ssize_t len = readlink(path, line, sizeof(line) - 1);
        if (len > 0) {
            line[len] = 0;
            if (named(line, false) || (c.discord && named(line, true))) return true;
        }
        if (parent == pid) break;
        pid = parent;
    }
    return false;
}
static bool excluded(struct object *node) {
    struct object *client = find((uint32_t)strtoul(get(node, PW_KEY_CLIENT_ID), NULL, 10));
    // Wait for initial node/client identity before adding any capture links.
    if (!node->informed || (*get(node, PW_KEY_CLIENT_ID) && (!client || !client->informed))) return true;
    const char *keys[] = { PW_KEY_APP_ID, PW_KEY_APP_NAME, PW_KEY_APP_PROCESS_BINARY, "pipewire.access.portal.app_id", "flatpak.app-id", NULL };
    struct object *sources[] = { node, client };
    for (unsigned i = 0; i < 2; i++) {
        for (int j = 0; keys[j]; j++) {
            const char *s = get(sources[i], keys[j]);
            if (named(s, false) || (c.discord && named(s, true))) return true;
        }
        if (process_excluded(strtol(get(sources[i], PW_KEY_APP_PROCESS_ID), NULL, 10))) return true;
    }
    return false;
}
static bool eligible(struct object *port) {
    struct object *node = find((uint32_t)strtoul(get(port, PW_KEY_NODE_ID), NULL, 10));
    return port->port && !strcmp(get(port, PW_KEY_PORT_DIRECTION), "out") &&
        node && node->allowed;
}
static bool channel_matches(const char *out, const char *in) {
    return !strcmp(out, in) ||
        ((!strcmp(out, "MONO") || !strcmp(out, "AUX0")) && !strcmp(in, "FL")) ||
        ((!strcmp(out, "MONO") || !strcmp(out, "AUX1")) && !strcmp(in, "FR"));
}
static void link_info(void *data, const struct pw_link_info *info) {
    (void)data;
    if (info->state == PW_LINK_STATE_ERROR) fail(info->error ? info->error : "PipeWire audio link failed");
}
static const struct pw_link_events link_events = { PW_VERSION_LINK_EVENTS, .info = link_info };
static void reconcile(void) {
    uint32_t ours = pw_stream_get_node_id(c.stream);
    // Classification performs /proc reads only on the control loop, once per
    // playback node, rather than once for every channel link.
    for (struct object *o = c.objects; o; o = o->next)
        if (o->node) o->allowed = !strcmp(get(o, PW_KEY_MEDIA_CLASS), "Stream/Output/Audio") && !excluded(o);
    struct tap **cursor = &c.taps;
    while (*cursor) {
        struct tap *t = *cursor;
        struct object *out = find(t->output), *in = find(t->input);
        if (!out || !in || !eligible(out)) {
            *cursor = t->next;
            spa_hook_remove(&t->listener); pw_proxy_destroy(t->proxy); free(t);
        } else cursor = &t->next;
    }
    int inputs = 0;
    for (struct object *in = c.objects; in; in = in->next) {
        if (!in->port || strtoul(get(in, PW_KEY_NODE_ID), NULL, 10) != ours || strcmp(get(in, PW_KEY_PORT_DIRECTION), "in")) continue;
        inputs++;
        for (struct object *out = c.objects; out; out = out->next) {
            if (!eligible(out) || !channel_matches(get(out, "audio.channel"), get(in, "audio.channel"))) continue;
            bool linked = false;
            for (struct tap *t = c.taps; t; t = t->next) if (t->output == out->id && t->input == in->id) { linked = true; break; }
            if (linked) continue;
            struct pw_properties *props = pw_properties_new(NULL, NULL);
            pw_properties_setf(props, PW_KEY_LINK_OUTPUT_PORT, "%u", out->id);
            pw_properties_setf(props, PW_KEY_LINK_INPUT_PORT, "%u", in->id);
            pw_properties_set(props, PW_KEY_OBJECT_LINGER, "false");
            pw_properties_set(props, PW_KEY_LINK_PASSIVE, "true");
            struct pw_proxy *proxy = pw_core_create_object(c.core, "link-factory", PW_TYPE_INTERFACE_Link, PW_VERSION_LINK, &props->dict, 0);
            pw_properties_free(props);
            if (!proxy) { fail("Could not create PipeWire audio link"); return; }
            struct tap *t = calloc(1, sizeof(*t));
            t->output = out->id; t->input = in->id; t->proxy = proxy;
            t->next = c.taps; c.taps = t;
            pw_link_add_listener((struct pw_link *)proxy, &t->listener, &link_events, t);
        }
    }
    if (inputs == 8 && c.synced && !c.ready) {
        c.ready = true;
        fprintf(stderr, "ready 48000 2 s16le\n");
    }
}
static void node_info(void *data, const struct pw_node_info *info) {
    struct object *o = data;
    if (info->props) pw_properties_update(o->props, info->props);
    o->informed = true;
}
static void client_info(void *data, const struct pw_client_info *info) {
    struct object *o = data;
    if (info->props) pw_properties_update(o->props, info->props);
    o->informed = true;
}
static const struct pw_node_events node_events = { PW_VERSION_NODE_EVENTS, .info = node_info };
static const struct pw_client_events client_events = { PW_VERSION_CLIENT_EVENTS, .info = client_info };
static void global(void *data, uint32_t id, uint32_t permissions, const char *type, uint32_t version, const struct spa_dict *props) {
    (void)data; (void)permissions; (void)version;
    bool node = !strcmp(type, PW_TYPE_INTERFACE_Node), client = !strcmp(type, PW_TYPE_INTERFACE_Client), port = !strcmp(type, PW_TYPE_INTERFACE_Port);
    if (!node && !client && !port) return;
    struct object *o = calloc(1, sizeof(*o));
    o->id = id; o->node = node; o->client = client; o->port = port;
    o->props = props ? pw_properties_new_dict(props) : pw_properties_new(NULL, NULL);
    o->next = c.objects; c.objects = o;
    if (node || client) {
        o->proxy = pw_registry_bind(c.registry, id, type, node ? PW_VERSION_NODE : PW_VERSION_CLIENT, 0);
        if (node) pw_node_add_listener((struct pw_node *)o->proxy, &o->listener, &node_events, o);
        else pw_client_add_listener((struct pw_client *)o->proxy, &o->listener, &client_events, o);
    }
}
static void global_remove(void *data, uint32_t id) {
    (void)data;
    // Remove links immediately: PipeWire can reuse a port ID before our next
    // reconciliation timer, which must not leave a stale tap suppressing a new one.
    struct tap **links = &c.taps;
    while (*links) {
        struct tap *t = *links;
        if (t->input == id || t->output == id) {
            *links = t->next; spa_hook_remove(&t->listener); pw_proxy_destroy(t->proxy); free(t);
        } else links = &t->next;
    }
    struct object **cursor = &c.objects;
    while (*cursor) {
        struct object *o = *cursor;
        if (o->id == id) {
            *cursor = o->next;
            if (o->proxy) { spa_hook_remove(&o->listener); pw_proxy_destroy(o->proxy); }
            pw_properties_free(o->props); free(o); break;
        }
        cursor = &o->next;
    }
}
static const struct pw_registry_events registry_events = { PW_VERSION_REGISTRY_EVENTS, .global = global, .global_remove = global_remove };
static void core_done(void *data, uint32_t id, int seq) {
    (void)data;
    if (id != PW_ID_CORE || seq != c.sync_seq) return;
    c.synced = true;
    if (c.probe) { fprintf(stderr, "ready pipewire\n"); pw_main_loop_quit(c.loop); }
}
static void core_error(void *data, uint32_t id, int seq, int res, const char *message) {
    (void)data; (void)id; (void)seq;
    // A client/node may disappear between registry enumeration and binding.
    // These transient object errors are normal during app and device churn;
    // a core disconnect or a permission/format failure remains fatal.
    // The native protocol also reports vanished-resource ENOENT on core ID 0.
    if (res == -ENOENT || res == -ESTALE) return;
    fail(message);
}
static const struct pw_core_events core_events = { PW_VERSION_CORE_EVENTS, .done = core_done, .error = core_error };
static void process(void *data) {
    (void)data;
    struct pw_buffer *b = pw_stream_dequeue_buffer(c.stream);
    if (!b) return;
    struct spa_data *d = &b->buffer->datas[0];
    if (d->data && d->chunk && d->chunk->offset < d->maxsize) {
        uint32_t frames = SPA_MIN(d->chunk->size, d->maxsize - d->chunk->offset) / (8 * sizeof(float));
        uint32_t size = frames * 4;
        uint32_t w = atomic_load_explicit(&c.write, memory_order_relaxed), r = atomic_load_explicit(&c.read, memory_order_acquire);
        if (size <= RING_SIZE - (w - r)) {
            // Tap all standard surround channels, then downmix to stereo. This
            // preserves center dialogue without duplicating device monitor mixes.
            const uint8_t *source = (uint8_t *)d->data + d->chunk->offset;
            for (uint32_t frame = 0; frame < frames; frame++) {
                float channels[8] = {0};
                if (!(d->chunk->flags & SPA_CHUNK_FLAG_EMPTY)) memcpy(channels, source + frame * sizeof(channels), sizeof(channels));
                float samples[2] = {
                    channels[0] + 0.70710678f * (channels[2] + channels[4] + channels[6]) + 0.5f * channels[3],
                    channels[1] + 0.70710678f * (channels[2] + channels[5] + channels[7]) + 0.5f * channels[3],
                };
                for (unsigned ch = 0; ch < 2; ch++) {
                    float sample = isfinite(samples[ch]) ? samples[ch] : 0;
                    int16_t pcm = sample >= 1 ? 32767 : sample <= -1 ? -32768 : (int16_t)(sample * 32768);
                    c.ring[(w + frame * 4 + ch * 2) & (RING_SIZE - 1)] = (uint16_t)pcm & 255;
                    c.ring[(w + frame * 4 + ch * 2 + 1) & (RING_SIZE - 1)] = (uint16_t)pcm >> 8;
                }
            }
            atomic_store_explicit(&c.write, w + size, memory_order_release);
        }
    }
    pw_stream_queue_buffer(c.stream, b);
}
static void stream_state(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error) {
    (void)data; (void)old;
    if (state == PW_STREAM_STATE_ERROR) fail(error ? error : "PipeWire capture failed");
}
static const struct pw_stream_events stream_events = { PW_VERSION_STREAM_EVENTS, .state_changed = stream_state, .process = process };
static void *writer(void *data) {
    (void)data;
    unsigned idle = 0;
    const uint8_t silence[480 * 4] = {0};
    while (!atomic_load(&c.stopping)) {
        uint32_t r = atomic_load_explicit(&c.read, memory_order_relaxed), w = atomic_load_explicit(&c.write, memory_order_acquire);
        if (r == w) {
            // Session managers can suspend an unlinked capture node when every
            // playback stream is excluded. Keep the outgoing track clocked with
            // silence until the first eligible stream starts, without linking a
            // microphone or waking a physical device to drive our clock.
            if (idle >= 16) {
                struct pollfd fd = { STDOUT_FILENO, POLLOUT, 0 };
                if (poll(&fd, 1, 100) > 0 && write(STDOUT_FILENO, silence, sizeof(silence)) < 0 && errno != EINTR && errno != EAGAIN) {
                    kill(getpid(), SIGTERM); break;
                }
            } else idle++;
            struct timespec wait = { .tv_nsec = idle >= 16 ? 10000000 : 5000000 };
            nanosleep(&wait, NULL); continue;
        }
        idle = 0;
        uint32_t at = r & (RING_SIZE - 1), size = SPA_MIN(w - r, RING_SIZE - at);
        struct pollfd fd = { STDOUT_FILENO, POLLOUT, 0 };
        if (poll(&fd, 1, 100) <= 0) continue;
        ssize_t n = write(STDOUT_FILENO, c.ring + at, size);
        if (n > 0) atomic_store_explicit(&c.read, r + (uint32_t)n, memory_order_release);
        else if (n < 0 && errno != EINTR && errno != EAGAIN) { kill(getpid(), SIGTERM); break; }
    }
    return NULL;
}
static void tick(void *data, uint64_t expirations) { (void)data; (void)expirations; reconcile(); }
static void stop(void *data, int signal) { (void)data; (void)signal; pw_main_loop_quit(c.loop); }
int main(int argc, char **argv) {
    c.probe = argc == 2 && !strcmp(argv[1], "--probe");
    c.owner = argc > 1 ? strtol(argv[1], NULL, 10) : 0;
    c.discord = argc > 2 && !strcmp(argv[2], "discord");
    if (!c.probe && (c.owner <= 1 || argc > 3 || (argc > 2 && !c.discord))) { fprintf(stderr, "error Usage: zodiak-pipewire-audio PID [discord] | --probe\n"); return 1; }
    signal(SIGPIPE, SIG_IGN);
    pw_init(NULL, NULL);
    c.loop = pw_main_loop_new(NULL);
    struct pw_loop *loop = pw_main_loop_get_loop(c.loop);
    pw_loop_add_signal(loop, SIGTERM, stop, NULL); pw_loop_add_signal(loop, SIGINT, stop, NULL);
    c.context = pw_context_new(loop, NULL, 0);
    c.core = pw_context_connect(c.context, NULL, 0);
    if (!c.core) { fprintf(stderr, "error PipeWire is unavailable: %s\n", strerror(errno)); return 1; }
    pw_core_add_listener(c.core, &c.core_listener, &core_events, NULL);
    c.sync_seq = pw_core_sync(c.core, PW_ID_CORE, 0);
    pthread_t thread;
    if (!c.probe) {
        c.registry = pw_core_get_registry(c.core, PW_VERSION_REGISTRY, 0);
        pw_registry_add_listener(c.registry, &c.registry_listener, &registry_events, NULL);
        c.stream = pw_stream_new(c.core, "Zodiak screen audio", pw_properties_new(
            PW_KEY_APP_NAME, "zodiak-pipewire-audio", PW_KEY_APP_ID, "app.zodiak",
            PW_KEY_NODE_NAME, "zodiak.screen-audio", PW_KEY_MEDIA_TYPE, "Audio",
            PW_KEY_MEDIA_CATEGORY, "Capture", PW_KEY_MEDIA_CLASS, "Stream/Input/Audio",
            PW_KEY_NODE_AUTOCONNECT, "false", PW_KEY_NODE_ALWAYS_PROCESS, "true",
            PW_KEY_NODE_WANT_DRIVER, "true", PW_KEY_NODE_RATE, "1/48000",
            PW_KEY_NODE_LATENCY, "480/48000", "node.dont-fallback", "true",
            "adapter.auto-port-config", "{ mode = dsp monitor = false position = preserve }", NULL));
        pw_stream_add_listener(c.stream, &c.stream_listener, &stream_events, NULL);
        uint8_t buffer[1024]; struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
        struct spa_audio_info_raw info = { .format = SPA_AUDIO_FORMAT_F32_LE, .rate = 48000, .channels = 8,
            .position = { SPA_AUDIO_CHANNEL_FL, SPA_AUDIO_CHANNEL_FR, SPA_AUDIO_CHANNEL_FC, SPA_AUDIO_CHANNEL_LFE, SPA_AUDIO_CHANNEL_RL, SPA_AUDIO_CHANNEL_RR, SPA_AUDIO_CHANNEL_SL, SPA_AUDIO_CHANNEL_SR } };
        const struct spa_pod *param = spa_format_audio_raw_build(&builder, SPA_PARAM_EnumFormat, &info);
        int res = pw_stream_connect(c.stream, PW_DIRECTION_INPUT, PW_ID_ANY, PW_STREAM_FLAG_MAP_BUFFERS | PW_STREAM_FLAG_RT_PROCESS, &param, 1);
        if (res < 0) { fprintf(stderr, "error Could not connect PipeWire capture: %s\n", strerror(-res)); return 1; }
        fcntl(STDOUT_FILENO, F_SETFL, fcntl(STDOUT_FILENO, F_GETFL) | O_NONBLOCK);
        if (pthread_create(&thread, NULL, writer, NULL)) { fprintf(stderr, "error Could not start audio writer\n"); return 1; }
        c.timer = pw_loop_add_timer(loop, tick, NULL);
        struct timespec interval = { .tv_nsec = 100000000 };
        pw_loop_update_timer(loop, c.timer, &interval, &interval, false);
    }
    pw_main_loop_run(c.loop);
    atomic_store(&c.stopping, true);
    if (!c.probe) {
        pthread_join(thread, NULL);
        while (c.taps) { struct tap *t = c.taps; c.taps = t->next; spa_hook_remove(&t->listener); pw_proxy_destroy(t->proxy); free(t); }
        pw_stream_destroy(c.stream);
        while (c.objects) global_remove(NULL, c.objects->id);
        pw_proxy_destroy((struct pw_proxy *)c.registry);
    }
    pw_core_disconnect(c.core); pw_context_destroy(c.context); pw_main_loop_destroy(c.loop); pw_deinit();
    return c.result;
}
