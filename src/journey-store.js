/** Saves only the public, prewritten script identifier. No user messages or preferences. */
export async function saveJourney(conversation, {fetcher=fetch,signal}={}) {
  const response=await fetcher('/api/journeys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seed:conversation.seed,version:conversation.version}),signal});
  if(!response.ok)throw new Error(response.status===429?'目前保存較忙，請稍後再試。':'雲端暫時無法保存，連結仍可重播同一份預寫劇本。');
  const data=await response.json();
  if(data?.journey?.seed!==conversation.seed||data?.journey?.version!==conversation.version)throw new Error('雲端回傳的旅程版本不符。');
  return data.journey;
}
