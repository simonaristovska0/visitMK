export interface WeatherResult {
  temp_c: number;
  feels_like_c: number;
  condition: string;
  humidity_percent: number;
  wind_kmh: number;
  uv_index: number;
  is_raining: boolean;
  recommendation: string;
}

interface WttrResponse {
  current_condition?: Array<{
    temp_C: string;
    FeelsLikeC: string;
    weatherDesc: Array<{ value: string }>;
    humidity: string;
    windspeedKmph: string;
    uvIndex: string;
    weatherCode: string;
  }>;
}

// Weather codes from wttr.in that indicate precipitation
const RAIN_CODES = new Set([
  "263","266","281","284","293","296","299","302","305","308",
  "311","314","317","320","323","326","356","359","362","365",
  "374","377","386","389",
]);

function recommendation(condition: string, isRaining: boolean, tempC: number): string {
  if (isRaining) return "Rain expected today — bring an umbrella.";
  if (tempC > 32) return "Very hot — stay hydrated and visit indoor attractions midday.";
  if (tempC < 5)  return "Cold today — dress warmly for outdoor sightseeing.";
  const lc = condition.toLowerCase();
  if (lc.includes("sunny") || lc.includes("clear")) return "Beautiful day — perfect for outdoor sightseeing!";
  if (lc.includes("cloud") || lc.includes("overcast")) return "Mild and cloudy — good for sightseeing without strong sun.";
  return "Good conditions for exploring Skopje today.";
}

export async function getWeather(lat: number, lng: number): Promise<WeatherResult> {
  const res = await fetch(`https://wttr.in/${lat},${lng}?format=j1`, {
    headers: { "User-Agent": "VisitMK/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`wttr.in returned ${res.status}`);
  const data = (await res.json()) as WttrResponse;
  const cc = data.current_condition?.[0];
  if (!cc) throw new Error("wttr.in: missing current_condition");

  const temp_c = Number(cc.temp_C);
  const feels_like_c = Number(cc.FeelsLikeC);
  const condition = cc.weatherDesc?.[0]?.value ?? "Unknown";
  const humidity_percent = Number(cc.humidity);
  const wind_kmh = Number(cc.windspeedKmph);
  const uv_index = Number(cc.uvIndex);
  const is_raining = RAIN_CODES.has(cc.weatherCode);

  return {
    temp_c, feels_like_c, condition,
    humidity_percent, wind_kmh, uv_index,
    is_raining,
    recommendation: recommendation(condition, is_raining, temp_c),
  };
}
