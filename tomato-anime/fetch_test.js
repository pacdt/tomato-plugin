async function run() {
  try {
    const res = await fetch("http://167.234.240.167:3000/video-temp?temp_id=132&current_id=132&cat_id=35297");
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();
