use js_sys::Math::random;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    AudioContext, AudioContextState, AudioNode, AudioScheduledSourceNode, BiquadFilterType,
};

#[derive(Clone, Default)]
pub struct Radio {
    pub static_level: f64,
    pub interference: f64,
    pub fading: f64,
}

pub async fn resume(ctx: &AudioContext) -> Result<(), JsValue> {
    JsFuture::from(ctx.resume()?).await?;
    if ctx.state() != AudioContextState::Running {
        return Err(
            js_sys::Error::new("Audio is paused. Tap Start or Repeat to enable it.").into(),
        );
    }
    Ok(())
}

#[derive(Default)]
pub struct Playback {
    sources: Vec<AudioScheduledSourceNode>,
    connections: Vec<AudioNode>,
}

impl Drop for Playback {
    fn drop(&mut self) {
        for source in &self.sources {
            let _ = source.stop();
            let _ = source.disconnect();
        }
        for node in &self.connections {
            let _ = node.disconnect();
        }
    }
}

impl Playback {
    pub fn tone(
        &mut self,
        ctx: &AudioContext,
        output: &AudioNode,
        hz: f64,
        at: f64,
        duration: f64,
        level: f64,
    ) -> Result<(), JsValue> {
        let osc = ctx.create_oscillator()?;
        let gain = ctx.create_gain()?;
        osc.frequency().set_value(hz as f32);
        osc.connect_with_audio_node(&gain)?;
        gain.connect_with_audio_node(output)?;
        gain.gain().set_value_at_time(0., at)?;
        gain.gain()
            .linear_ramp_to_value_at_time(level as f32, at + 0.005)?;
        gain.gain()
            .set_value_at_time(level as f32, at + (duration - 0.008).max(0.006))?;
        gain.gain()
            .linear_ramp_to_value_at_time(0., at + duration)?;
        self.connections.push(gain.unchecked_into());
        self.source(osc.unchecked_into(), at, at + duration + 0.02)
    }

    fn source(
        &mut self,
        node: AudioScheduledSourceNode,
        start: f64,
        end: f64,
    ) -> Result<(), JsValue> {
        self.sources.push(node.clone());
        node.start_with_when(start)?;
        node.stop_with_when(end)
    }

    pub fn radio(
        &mut self,
        ctx: &AudioContext,
        start: f64,
        duration: f64,
        hz: f64,
        volume: f64,
        radio: &Radio,
    ) -> Result<Option<AudioNode>, JsValue> {
        if radio.static_level == 0. && radio.interference == 0. && radio.fading == 0. {
            return Ok(None);
        }
        let end = start + duration + 0.12;
        let output = ctx.create_gain()?;
        self.connections.push(output.clone().unchecked_into());
        output.connect_with_audio_node(&ctx.destination())?;
        output.gain().set_value_at_time(0., start - 0.05)?;
        output
            .gain()
            .linear_ramp_to_value_at_time(volume as f32, start)?;
        output.gain().set_value_at_time(volume as f32, end - 0.05)?;
        output.gain().linear_ramp_to_value_at_time(0., end)?;

        let input = if radio.fading > 0. {
            let fade = ctx.create_gain()?;
            self.connections.push(fade.clone().unchecked_into());
            fade.connect_with_audio_node(&output)?;
            let depth = radio.fading / 100.;
            let strength = 1. - depth * (0.15 + random() * 0.45);
            let phase = random() * std::f64::consts::TAU;
            let period = 2.5 + random() * 4.;
            let span = end - start;
            let count = (span * 30.).ceil().max(2.) as usize;
            let mut curve: Vec<_> = (0..count)
                .map(|i| {
                    let t = i as f64 / (count - 1) as f64 * span;
                    let swell = (1. + (phase + t * std::f64::consts::TAU / period).sin()) / 2.;
                    let flutter = (1. + (phase * 2. + t * 11.).sin()) / 2.;
                    (strength * (1. - depth * (0.75 * swell + 0.1 * flutter))) as f32
                })
                .collect();
            fade.gain()
                .set_value_curve_at_time(&mut curve, start, span)?;
            fade
        } else {
            output.clone()
        };

        if radio.static_level > 0. {
            let rate = ctx.sample_rate() as f64;
            let count = (rate * 3.7).ceil() as u32;
            for (weight, crackle) in [(0.35, false), (0.65, true)] {
                let mut burst = 0.;
                let decay = (-1. / (rate * 0.006)).exp();
                let samples: Vec<_> = (0..count)
                    .map(|_| {
                        if crackle && random() < 12. / rate {
                            burst = 0.3 + random() * 0.7;
                        }
                        burst *= decay;
                        ((random() * 2. - 1.) * if crackle { burst } else { 1. }) as f32
                    })
                    .collect();
                let buffer = ctx.create_buffer(1, count, ctx.sample_rate())?;
                buffer.copy_to_channel(&samples, 0)?;
                let node = ctx.create_buffer_source()?;
                node.set_buffer(Some(&buffer));
                node.set_loop(true);
                let filter = ctx.create_biquad_filter()?;
                filter.set_type(BiquadFilterType::Bandpass);
                filter.frequency().set_value(hz as f32);
                filter.q().set_value(0.65);
                let gain = ctx.create_gain()?;
                gain.gain()
                    .set_value((weight * radio.static_level / 100.) as f32);
                node.connect_with_audio_node(&filter)?;
                filter.connect_with_audio_node(&gain)?;
                gain.connect_with_audio_node(&output)?;
                self.connections
                    .extend([filter.unchecked_into(), gain.unchecked_into()]);
                self.source(node.unchecked_into(), start - 0.05, end)?;
            }
        }

        if radio.interference > 0. {
            let level = (radio.interference / 100.) as f32;
            for nearby in [false, true] {
                let osc = ctx.create_oscillator()?;
                let gain = ctx.create_gain()?;
                let hz = (hz + if nearby { 170. } else { -230. }).max(150.) as f32;
                osc.frequency().set_value_at_time(hz, start)?;
                osc.frequency()
                    .linear_ramp_to_value_at_time(hz + random() as f32 * 24. - 12., end)?;
                gain.gain().set_value_at_time(0., start - 0.05)?;
                if nearby {
                    let mut t = start + 0.1;
                    while t < end - 0.2 {
                        let length =
                            (if random() < 0.5 { 0.075_f64 } else { 0.225 }).min(end - t - 0.01);
                        gain.gain().set_value_at_time(0., t)?;
                        gain.gain()
                            .linear_ramp_to_value_at_time(0.055 * level, t + 0.005)?;
                        gain.gain()
                            .set_value_at_time(0.055 * level, t + length - 0.005)?;
                        gain.gain().linear_ramp_to_value_at_time(0., t + length)?;
                        t += length + if random() < 0.25 { 0.45 } else { 0.075 };
                    }
                } else {
                    gain.gain()
                        .linear_ramp_to_value_at_time(0.025 * level, start)?;
                }
                osc.connect_with_audio_node(&gain)?;
                gain.connect_with_audio_node(&output)?;
                self.connections.push(gain.unchecked_into());
                self.source(osc.unchecked_into(), start - 0.05, end)?;
            }
        }
        Ok(Some(input.unchecked_into()))
    }
}
