// Deterministic application playback for private-daemon integration tests.
// Use the native API because Ubuntu 22.04's pw-cat lacks --raw/--properties.
#define _GNU_SOURCE
#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>
#include <math.h>
#include <signal.h>
#include <stdlib.h>
#include <stdio.h>

static struct pw_main_loop *loop;
static struct pw_stream *stream;
static unsigned rate, channels;
static double frequency;
static uint64_t frame;
static bool center;
static int result;

static void process(void *data) {
    (void)data;
    struct pw_buffer *b = pw_stream_dequeue_buffer(stream);
    if (!b) return;
    struct spa_data *d = &b->buffer->datas[0];
    unsigned stride = channels * sizeof(float);
    unsigned frames = d->maxsize / stride;
#if PW_CHECK_VERSION(0, 3, 50)
    if (b->requested) frames = SPA_MIN(frames, b->requested);
#endif
    float *samples = d->data;
    for (unsigned i = 0; i < frames; i++, frame++) {
        float value = (3000.0 / 32768) * sin(2 * M_PI * frequency * frame / rate);
        for (unsigned ch = 0; ch < channels; ch++) samples[i * channels + ch] = center && ch != 2 ? 0 : value;
    }
    d->chunk->offset = 0; d->chunk->stride = stride; d->chunk->size = frames * stride;
    b->size = frames;
    pw_stream_queue_buffer(stream, b);
}
static void state_changed(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error) {
    (void)data; (void)old;
    if (state == PW_STREAM_STATE_ERROR) {
        fprintf(stderr, "%s\n", error); result = 1; pw_main_loop_quit(loop);
    }
}
static const struct pw_stream_events events = { PW_VERSION_STREAM_EVENTS, .state_changed = state_changed, .process = process };
static void stop(void *data, int signal) { (void)data; (void)signal; pw_main_loop_quit(loop); }
int main(int argc, char **argv) {
    if (argc != 6) return 1;
    frequency = strtod(argv[1], NULL); rate = strtoul(argv[2], NULL, 10);
    channels = strtoul(argv[3], NULL, 10); center = atoi(argv[4]);
    if (channels != 1 && channels != 2 && channels != 6) return 1;
    pw_init(NULL, NULL);
    loop = pw_main_loop_new(NULL);
    struct pw_loop *pwloop = pw_main_loop_get_loop(loop);
    pw_loop_add_signal(pwloop, SIGTERM, stop, NULL); pw_loop_add_signal(pwloop, SIGINT, stop, NULL);
    struct pw_properties *props = pw_properties_new_string(argv[5]);
    pw_properties_set(props, PW_KEY_MEDIA_TYPE, "Audio"); pw_properties_set(props, PW_KEY_MEDIA_CATEGORY, "Playback");
    pw_properties_set(props, PW_KEY_NODE_AUTOCONNECT, "false");
    struct spa_audio_info_raw info = { .format = SPA_AUDIO_FORMAT_F32_LE, .rate = rate, .channels = channels };
    if (channels == 1) info.position[0] = SPA_AUDIO_CHANNEL_MONO;
    else {
        const uint32_t positions[] = { SPA_AUDIO_CHANNEL_FL, SPA_AUDIO_CHANNEL_FR, SPA_AUDIO_CHANNEL_FC, SPA_AUDIO_CHANNEL_LFE, SPA_AUDIO_CHANNEL_RL, SPA_AUDIO_CHANNEL_RR };
        for (unsigned i = 0; i < channels; i++) info.position[i] = positions[i];
    }
    stream = pw_stream_new_simple(pwloop, "Test tone", props, &events, NULL);
    uint8_t buffer[1024]; struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
    const struct spa_pod *param = spa_format_audio_raw_build(&builder, SPA_PARAM_EnumFormat, &info);
    if (pw_stream_connect(stream, PW_DIRECTION_OUTPUT, PW_ID_ANY, PW_STREAM_FLAG_MAP_BUFFERS | PW_STREAM_FLAG_RT_PROCESS, &param, 1) < 0) return 1;
    pw_main_loop_run(loop);
    pw_stream_destroy(stream); pw_main_loop_destroy(loop); pw_deinit();
    return result;
}
