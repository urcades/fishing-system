//! Test-only oracle: import the published crate; never duplicate simulation laws.
use fishing::{create_state, observe, resolve, step, Config, Definition, Input, Loadout};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read};
#[derive(Deserialize)]
struct Case {
    config: Config,
    seed: u32,
    inputs: Vec<Input>,
}
#[derive(Deserialize)]
struct Profile {
    definition: Definition,
    loadout: Loadout,
    seed: u32,
}
#[derive(Deserialize)]
struct Request {
    cases: Vec<Case>,
    profiles: Vec<Profile>,
}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let request: Request = serde_json::from_str(&input).unwrap();
    let traces: Vec<Value> = request
        .cases
        .into_iter()
        .map(|case| {
            let mut state = create_state(case.seed, &case.config).unwrap();
            let initial = state.clone();
            let mut frames = Vec::new();
            for input in case.inputs {
                let r = step(&state, input, &case.config).unwrap();
                let observation = observe(&r.state, &case.config).unwrap();
                frames.push(json!({"result": r, "observation": observation}));
                state = r.state;
            }
            json!({"initial":initial,"frames":frames})
        })
        .collect();
    let profiles: Vec<_> = request
        .profiles
        .into_iter()
        .map(|p| resolve(&p.definition, &p.loadout, p.seed).unwrap())
        .collect();
    println!("{}", json!({"traces":traces,"profiles":profiles}));
}
