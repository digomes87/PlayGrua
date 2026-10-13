# PlayGrua

Simulador de operação de grua torre que roda 100 % no navegador. Não é um jogo arcade: a grua tem
inércia, a carga balança como um pêndulo de verdade, o limitador de momento bloqueia os movimentos e
o vento empurra a carga e a lança. Quando houve dúvida entre jogável e realista, ficou o realista, e
o parâmetro está em [`src/craneSpec.ts`](src/craneSpec.ts).

Publicado em: <https://digomes87.github.io/PlayGrua/>

## Rodar localmente

Requer Node 22 ou mais novo.

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm test           # testes da física e da simulação (Vitest)
npm run test:e2e   # testes no navegador: Chrome, Firefox e WebKit (npx playwright install firefox webkit)
npm run build      # gera dist/
npm run preview    # serve o build em /PlayGrua/
```

## Controles

| Teclado | Ação |
| --- | --- |
| `A` / `D` | Giro à esquerda / direita |
| `W` / `S` | Carrinho para fora / para dentro |
| `↑` / `↓` | Guincho sobe / desce |
| `Shift` | Modo fino (25 % da velocidade) |
| `Espaço` ou `E` | Engatar a carga sob o gancho / soltar a carga apoiada |
| `C` | Trocar câmera: cabine, externa, gancho |
| `H` | Buzina |
| `X` | Parada de emergência (trava; `X` de novo rearma) |
| `V` | Modo cata-vento: libera o freio de giro |
| `R` / `Esc` | Reiniciar a missão / menu |

Gamepad no padrão de cabine: analógico esquerdo X = giro, Y = carrinho; analógico direito Y =
guincho (puxar sobe). `A` engata, `B` emergência, `X` buzina, `Y` câmera, `LB` modo fino, `RB`
cata-vento. Curva expo e zona morta são ajustáveis no menu. Teclado e gamepad funcionam juntos.

O joystick comanda **velocidade alvo**, nunca posição. Soltar o comando não para a grua: cada eixo
desacelera na sua rampa e a carga continua balançando.

Para engatar, leve o gancho até 1,2 m do centro da carga e a no máximo 3 m acima dela; fora de centro
a carga sai balançando. Para soltar,
a carga precisa estar apoiada e o cabo aliviado (desça até a chave de cabo frouxo parar o guincho).

## Missões

1. **Treino livre**: sem cronômetro, quatro cargas no pátio.
2. **Içamento básico**: 2 t de ferragem a 12 m de raio até a laje a 30 m de altura.
3. **Carga no limite**: 3 t até o raio em que o momento chega a 95 %, por 3 s, sem acionar o bloqueio.
4. **Vento**: painel de forma de 12 m² com rajadas de até 40 km/h.
5. **Precisão**: alvo de 0,5 m de raio com balanço menor que 2° no pouso.
6. **Viga pesada**: 5 t na marcha lenta do guincho até o berço do outro lado da torre.

Ao fim da missão, **Rever a operação** repete tudo a 4×. O replay não é um vídeo: a simulação é
determinística, então ele roda a missão de novo com os comandos gravados e chega ao mesmo estado.

A pontuação parte de 1000 e desconta tempo acima da referência, balanço máximo, velocidade de pouso,
picos de momento e colisões. Sobrecarga acima de 110 % é falha grave. Os melhores resultados ficam no
`localStorage`.

## Modelo físico

Tudo em SI, em `src/physics`, sem dependência do Three.js. Passo fixo de 120 Hz desacoplado do
framerate (acumulador), com o estado interpolado para a renderização. A simulação é determinística:
mesma entrada e mesma semente de vento geram o mesmo estado, bit a bit.

### Carga: pêndulo duplo

Moitão e carga são duas massas. O cabo liga o carrinho ao moitão e as lingas ligam o moitão à carga;
os dois são **mola-amortecedor que só traciona**. As equações são as de Newton no referencial
inercial, em coordenadas cartesianas, integradas juntas por RK4:

```
m₁·a₁ = m₁·g − T·d̂₁ + S·d̂₂ + arrasto do moitão − c·v⊥
m₂·a₂ = m₂·g − S·d̂₂ + F_aero(ψ)
I_z·ψ̈ = M_aero(ψ) + M_cabo − c_destorcedor·ψ̇
T     = max(0, k·(|d₁| − L) + c_axial·d(|d₁| − L)/dt)
k     = 1 / (1/(E·A/(L + L_fixo)) + 1/k_estrutura)
```

onde `d₁` vai do carrinho ao moitão, `d₂` do moitão à carga, `L(t)` é o cabo desenrolado e `ψ` é a
orientação da carga em torno da vertical. Como o ponto de suspensão se move de verdade (translação do
carrinho e rotação da lança), as acelerações centrípeta e tangencial e o termo de Coriolis da variação
de `L` aparecem sozinhos, sem hipótese de pequenos ângulos. Consequências que saem do modelo:

- cabo ou linga frouxos não empurram: a carga cai livre ou fica apoiada;
- içar com tranco gera pico de tensão, e o LMI mostra esse pico;
- encurtar o cabo de uma carga balançando aumenta o ângulo de balanço;
- o cabo e as lingas fazem ângulo entre si: carga leve em linga longa balança no modo lento do
  pêndulo duplo, mais devagar que `2π√(L/g)` (frequência medida a menos de 1 % da analítica);
- engatar fora de centro deixa a linga inclinada e a carga sai balançando.

**Vento na carga.** Cada par de faces verticais é uma placa plana: força normal pela lei de
Rayleigh-Kirchhoff, escalada para dar o `Cd` da carga de frente para o vento, aplicada num centro de
pressão que anda para o bordo de ataque em baixa incidência. Por isso o arrasto depende da orientação
(um painel de lado pega uma fração do vento) e o vento gira o painel até ficar atravessado. A carga
não acompanha o giro da lança: só o torque fraco das duas quedas de cabo a realinha.

No chão a carga tem atrito de Coulomb (μ estático 0,5, cinético 0,4): tração lateral pequena não a
move, acima do limite ela é arrastada, e ela só sai do chão quando a componente vertical da tração
passa do peso. Uma carga que pousa com velocidade lateral derrapa até o atrito pará-la.

### Atuadores

Os três eixos usam o mesmo modelo de acionamento: o joystick move uma referência de velocidade em
rampa, o motor a segue enquanto tiver força, e com o comando solto e a referência em zero o freio
fecha, com capacidade limitada.

- **Giro**: duas inércias ligadas pela torção de torre e lança. Motor e freio agem no acionamento;
  vento e cabo agem na lança: `I(r)·ω̇ = τ_torção + τ_vento + τ_cabo − 2·m_carrinho·r·ṙ·ω`. A inércia
  `I` é calculada das massas de lança, contra-lança, contrapeso e carrinho; a carga entra pela força
  real do cabo no carrinho, então uma carga pesada na ponta atrasa a aceleração e uma carga balançando
  puxa a lança. A lança atrasa na partida e fica vibrando depois que o freio fecha, com
  `T = 2π√(I/K)` (cerca de 2,5 s) e 5 % de amortecimento. O motor satura em 220 kN·m e o freio em
  300 kN·m, e vento forte o faz escorregar.
- **Carrinho**: a componente do cabo ao longo da lança e a força centrífuga agem no carrinho. O
  motor dá até 9 kN e o freio segura 14 kN; uma carga pesada balançando forte arrasta o carrinho.
- **Guincho**: a tensão do cabo age no tambor. As marchas são limites de força (55 kN a 1,2 m/s,
  106 kN a 0,6 m/s, a mesma potência), então um pico acima disso faz o guincho ceder em vez de subir.
  Tem redução de velocidade antes dos fins de curso e chave de cabo frouxo.
- **Emergência**: os três freios fecham na capacidade máxima.

### Tabela de carga e LMI

Tabela discreta interpolada: 8 t até 15 m e depois momento aproximadamente constante,
`Q(r) ≈ 90/(r − 3,75)` t, fechando em 1,6 t a 60 m. A carga medida vem da tensão do cabo (carga +
moitão + efeito dinâmico) por um filtro de 0,1 s.

| Momento | Efeito |
| --- | --- |
| 90 % | alarme sonoro e visual intermitente |
| 100 % | bloqueia subir carga e carrinho para fora; descer e recolher continuam liberados |
| 110 % | registrado como sobrecarga, falha grave na missão |

O bloqueio só é liberado abaixo de 97 %.

### Vento

Velocidade média mais rajadas por processo de Ornstein-Uhlenbeck com semente, direção que varia
devagar e perfil de velocidade com a altura (lei de potência, expoente 0,15). Força na carga
`F = ½·ρ·Cd·A·v²` com a velocidade relativa do ar e `Cd·A` por tipo de carga; o vento na lança, na
contra-lança e no contrapeso gera torque de giro, e a grua tende a alinhar a lança a favor do vento.
Alerta a partir de 50 km/h. Acima de 72 km/h a operação é bloqueada (só descer a carga continua
permitido) e o operador deve liberar o giro com `V`.

### Sistemas de segurança

- **LMI**: a partir de 90 % subir carga e carrinho para fora ficam a 25 % da velocidade, para o
  bloqueio de 100 % chegar devagar e sem pico.
- **Zoneamento**: o carrinho não entra em zona proibida (a rua além do tapume). O sistema recusa o
  giro ou o carrinho que levaria o ponto de suspensão a menos de 2 m da zona, e deixa livre o
  movimento de afastar.
- **Cabo em estrutura**: se a reta do carrinho ao moitão atravessa um prédio, o painel alarma e a
  missão conta como colisão. O cabo não dobra na quina: é só detecção.

### Colisões

Carga e moitão contra o chão, os prédios, as pilhas e as outras cargas, todos como blocos alinhados
aos eixos. O topo de qualquer bloco é superfície de pouso, desde que o centro de gravidade da carga
esteja sobre ele: com o centro para fora da borda a carga não fica apoiada e cai. Pouso acima de 0,5 m/s conta como brusco.

## Testes

`npm test` roda 250 testes, entre eles os obrigatórios:

- período do pêndulo contra `2π√(L/g)` para cabos de 5, 20 e 40 m, erro abaixo de 1 %;
- frequência do modo lento do pêndulo duplo contra a solução analítica, erro abaixo de 1 %;
- conservação de energia sem amortecimento nem atuação: deriva abaixo de 0,5 % em 60 s;
- tabela de carga nos pontos tabelados e interpolação monotônica;
- bloqueio do LMI a 100 %, isolado e com a grua em operação;
- determinismo: duas execuções com a mesma entrada e semente dão estado idêntico.

Há também testes de conservação do momento angular de lança, moitão e carga com o giro livre
(deriva abaixo de 1 % em 30 s), das três missões de pouso jogadas do início ao fim por um piloto
automático, da vibração de torção da lança, dos limites de força dos acionamentos, atrito de solo, cabo frouxo, pico de carga no tranco, vento na carga, cata-vento,
colisões, missões, pontuação e persistência.

## Limitações conhecidas

- A aerodinâmica da carga é quase-estática. Num painel grande ela prevê oscilação acoplada de
  orientação e balanço que cresce quando as duas frequências coincidem (perto de 8 m/s para o painel
  de 12 m² em 24 m de cabo). O mecanismo é real, mas a amplitude não foi validada contra medição.
- A carga gira só em torno da vertical: não tomba nem inclina além do ângulo das lingas. Não há
  cabo-guia.
- A flexibilidade da estrutura são duas molas: torção entre o acionamento de giro e a lança, e
  rigidez vertical em série com o cabo. A lança não tem modos de flexão próprios.
- Colisões simplificadas: a carga é um prisma de base quadrada (média das duas dimensões, qualquer
  que seja a orientação). O cabo e a lança não colidem com os prédios.
- Cargas apoiadas não são levadas pelo vento.
- Sem modo fora de serviço completo, sem falhas de equipamento, sem gráfico de telemetria e sem
  editor da especificação da grua na interface (os valores ficam em `src/craneSpec.ts`).

## Estrutura

```
src/
  craneSpec.ts   todos os valores de referência da grua
  physics/       núcleo físico puro e testável
  sim/           passo de simulação, colisões, lingada, missões, pontuação
  render/        cena Three.js, modelos procedurais, câmeras
  input/         teclado, gamepad, curvas de resposta
  ui/            painel de instrumentos, menus, áudio
tests/           testes Vitest
e2e/             testes Playwright
```

## Deploy

O workflow [`deploy.yml`](.github/workflows/deploy.yml) testa, gera o build e publica no GitHub Pages
a cada push na `main`. No repositório, em *Settings → Pages*, a fonte precisa estar em **GitHub
Actions**. O `base` do Vite está configurado para `/PlayGrua/`.

O fluxo de branches é gitflow: `feature/*` entra em `develop`, e `release/*` leva `develop` para a
`main`.
