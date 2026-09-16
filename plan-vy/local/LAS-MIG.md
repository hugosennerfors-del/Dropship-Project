# Dubbelklicka INSTALLERA.bat — en gång

Efter det finns sidan på `http://localhost:4173` hela tiden. Inget fönster
behöver vara öppet, och den startar av sig själv varje gång du loggar in.

En genväg som heter **Plan-vy Intelligence** hamnar på skrivbordet.

## Vad installeraren gör

1. Startar servern med dolt fönster
2. Lägger en startfil i Autostart-mappen, så den kommer igång vid inloggning
3. Skapar skrivbordsgenvägen

Servern är ett Node-skript på 80 rader som serverar mappen `out/`. Den
kontrollerar att den inte redan kör, så du kan trycka på INSTALLERA flera gånger
utan att få flera servrar.

## Ta bort

`AVINSTALLERA.bat` stoppar servern, tar bort autostarten och genvägen.
Mappen ligger kvar.

## Vad som behövs

Node.js. Har du kört `npx` tidigare har du det — installeraren kollar och säger
till annars.

## Var kommer datan ifrån?

Samma n8n-webhook som förut. Sidan är bara filer och hämtar allt i webbläsaren,
därför fungerar den lokalt utan att något driftsätts.

Lösenordsgrinden finns inte här — den satt i Netlifys edge function. Sidan är
bara nåbar från din egen dator.

## Om något strular

**Sidan svarar inte:** dubbelklicka `start-dold.vbs` direkt.

**Porten upptagen:** något annat använder 4173. Kör `AVINSTALLERA.bat` och sedan
`INSTALLERA.bat` igen.

**Vill se felmeddelanden:** öppna en terminal i mappen och kör
`node serve-local.mjs` — då syns allt servern skriver.
