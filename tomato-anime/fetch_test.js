async function run() {
  try {
    const res = await fetch("http://167.234.240.167:3000/video-temp?cat_id=8386");
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text.substring(0, 1000));
  } catch (e) {
    console.error(e);
  }
}
run();
