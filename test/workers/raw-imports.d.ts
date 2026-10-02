// Vite's ?raw suffix imports a file's text; the Workers test pool builds tests with Vite, so the README is read as written rather than copied into the tests.
declare module "*.md?raw" {
  const text: string;
  export default text;
}
