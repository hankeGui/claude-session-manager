export function cleanMessageContent(text: string): string {
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '/$1')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
    .replace(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g, '\u2192 $1')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[\s\S]*?<\/antml:[^>]*>/g, '')
    .replace(/<\/?antml:[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
