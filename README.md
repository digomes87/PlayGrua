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
npm run test:e2e   # testes no navegador (Playwright, usa o Chrome instalado)
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

Para engatar, leve o gancho até 1,2 m do centro da carga e a no máximo 3 m acima dela. Para soltar,
a carga precisa estar apoiada e o cabo aliviado (desça até a chave de cabo frouxo parar o guincho).

## Missões

1. **Treino livre**: sem cronômetro, quatro cargas no pátio.
2. **Içamento básico**: 2 t de ferragem a 12 m de raio até a laje a 30 m de altura.
3. **Carga no limite**: 3 t até o raio em que o momento chega a 95 %, por 3 s, sem acionar o bloqueio.
4. **Vento**: painel de forma de 12 m² com rajadas de até 40 km/h.
5. **Precisão**: alvo de 0,5 m de raio com balanço menor que 2° no pouso.

A pontuação parte de 1000 e desconta tempo acima da referência, balanço máximo, velocidade de pouso,
picos de momento e colisões. Sobrecarga acima de 110 % é falha grave. Os melhores resultados ficam no
`localStorage`.

## Modelo físico

Tudo em SI, em `src/physics`, sem dependência do Three.js. Passo fixo de 120 Hz desacoplado do
framerate (acumulador), com o estado interpolado para a renderização. A simulação é determinística:
mesma entrada e mesma semente de vento geram o mesmo estado, bit a bit.

### Carga: pêndulo esférico

A carga é uma massa pontual no centro de gravidade do conjunto moitão + carga, ligada ao carrinho por
um cabo que é uma **mola-amortecedor que só traciona**. As equações são as de Newton no referencial
inercial, em coordenadas cartesianas, integradas por RK4:

```
m·a = m·g − T·d̂ + ½·ρ·Cd·A·|v_ar − v|·(v_ar − v) − c·v⊥
T   = max(0, k·(|d| − L) + c_axial·d(|d| − L)/dt)
k   = 1 / (1/(E·A/(L + L_fixo)) + 1/k_estrutura)
```

onde `d` vai do carrinho à carga e `L(t)` é o comprimento de cabo desenrolado. Como o ponto de
suspensão se move de verdade (translação do carrinho e rotação da lança), as acelerações centrípeta e
tangencial, e o termo de Coriolis da variação de `L`, aparecem sozinhos, sem hipótese de pequenos
ângulos. Consequências que saem do modelo, sem regra especial:

- cabo frouxo não empurra: com `T = 0` a carga cai livre ou fica apoiada;
- içar com tranco gera pico de tensão, e o LMI mostra esse pico;
- encurtar o cabo de uma carga balançando aumenta o ângulo de balanço;
- o período de pequenas oscilações é `2π√(L/g)` (erro medido de 0,01 %).

No chão a carga tem atrito de Coulomb (μ estático 0,5, cinético 0,4): tração lateral pequena não a
move, acima do limite ela é arrastada, e ela só sai do chão quando a componente vertical da tração
passa do peso. Uma carga que pousa com velocidade lateral derrapa até o atrito pará-la.

### Atuadores

- **Giro**: acionado por torque. `I(r)·ω̇ = τ_motor + τ_vento + τ_cabo − 2·m_carrinho·r·ṙ·ω`. A inércia
  `I` é calculada das massas de lança, contra-lança, contrapeso e carrinho; a carga entra pela força
  real do cabo no carrinho, então uma carga pesada na ponta atrasa a aceleração e uma carga balançando
  puxa a lança. O motor é uma malha de velocidade saturada em 220 kN·m. Com o comando solto a
  referência desce na rampa de frenagem e só então o freio de estacionamento fecha, com torque limitado
  (vento forte o faz escorregar).
- **Carrinho** e **guincho**: inversores com rampas de aceleração e desaceleração e redução de
  velocidade antes dos fins de curso. O guincho cai de 1,2 para 0,6 m/s acima de 4 t e tem chave de
  cabo frouxo.
- **Emergência**: guincho e carrinho param nas rampas de emergência e o giro freia no torque máximo.

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

### Colisões

Carga e moitão contra o chão, os prédios, as pilhas e as outras cargas, todos como blocos alinhados
aos eixos. O topo de qualquer bloco é superfície de pouso, desde que o centro de gravidade da carga
esteja sobre ele: com o centro para fora da borda a carga não fica apoiada e cai. Pouso acima de 0,5 m/s conta como brusco.

## Testes

`npm test` roda 196 testes, entre eles os obrigatórios:

- período do pêndulo contra `2π√(L/g)` para cabos de 5, 20 e 40 m, erro abaixo de 1 %;
- conservação de energia sem amortecimento nem atuação: deriva abaixo de 0,5 % em 60 s;
- tabela de carga nos pontos tabelados e interpolação monotônica;
- bloqueio do LMI a 100 %, isolado e com a grua em operação;
- determinismo: duas execuções com a mesma entrada e semente dão estado idêntico.

Há também testes de conservação do momento angular do conjunto lança + carga com o giro livre
(deriva abaixo de 1 % em 30 s), atrito de solo, cabo frouxo, pico de carga no tranco, vento na carga, cata-vento,
colisões, missões, pontuação e persistência.

## Limitações conhecidas

- Moitão, lingas e carga formam um elo rígido alinhado ao cabo: não há pêndulo duplo nem rotação da
  carga em torno do cabo. A área de arrasto de cada carga é constante, independente da orientação.
- A flexibilidade da lança e da torre entra só como rigidez vertical em série com o cabo. A lança não
  flete visualmente nem torce no giro.
- Carrinho e guincho seguem a rampa do inversor: a carga não os arrasta de volta.
- Colisões simplificadas: a carga é um prisma de base quadrada (média das duas dimensões), sem
  tombamento. O cabo e a lança não colidem com os prédios.
- Cargas apoiadas não são levadas pelo vento.
- Sem modo fora de serviço completo, sem múltiplas quedas de cabo configuráveis e sem falhas de
  equipamento.

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
