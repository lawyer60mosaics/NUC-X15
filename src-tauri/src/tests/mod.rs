#[expect(
    clippy::module_inception,
    reason = "Existing test module layout is outside this bug fix."
)]
pub mod tests;
