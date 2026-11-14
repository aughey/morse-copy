mod page;
mod practice;
mod settings;

use self::page::{CompatibilityNotes, Intro, PracticeGuide, SiteFooter, SiteHeader, WelcomeDialog};
use self::practice::PracticeStation;
use self::settings::StationSettings;
use crate::session::Session;
use gloo_events::EventListener;
use leptos::prelude::*;

pub fn app() -> impl IntoView {
    let session = Session::new();
    let welcome = NodeRef::<leptos::html::Dialog>::new();

    let window = web_sys::window().unwrap();
    let document = window.document().unwrap();
    let visibility = EventListener::new(&document.clone(), "visibilitychange", move |_| {
        if document.hidden() {
            session.end();
        }
        session.keep_awake();
    });
    let page_hide = EventListener::new(&window, "pagehide", move |_| session.end());
    let focus = EventListener::new(&window, "focus", move |_| session.keep_awake());
    // The component owns these listeners for the lifetime of the mounted app.
    let listeners = StoredValue::new_local([visibility, page_hide, focus]);
    on_cleanup(move || {
        listeners.dispose();
    });

    view! {
        <WelcomeDialog welcome=welcome />
        <SiteHeader />
        <main>
            <Intro />
            <div class="workspace">
                <PracticeStation session=session />
                <StationSettings session=session />
            </div>
            <PracticeGuide />
            <CompatibilityNotes />
        </main>
        <SiteFooter welcome=welcome />
    }
}
