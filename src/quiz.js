/**
 * VLA / OpenVLA quiz bank — bilingual at low levels, English at high levels.
 * quizLanguage: auto | bi-ch&en | eng-only
 */

const QUESTIONS = [
  {
    minLevel: 1,
    maxLevel: 2,
    topics: ['openvla', 'vla'],
    question: 'What does "VLA" stand for in robotics?',
    questionZh: '机器人领域里 "VLA" 指什么？',
    options: [
      'Vision-Language-Action',
      'Video-Latent-Attention',
      'Vector-Linear-Activation',
      'Visual-Loop-Automation',
    ],
    optionsZh: [
      '视觉-语言-动作（Vision-Language-Action）',
      '视频-潜变量-注意力',
      '向量-线性-激活',
      '视觉-闭环-自动化',
    ],
    answer: 0,
  },
  {
    minLevel: 1,
    maxLevel: 2,
    topics: ['openvla', 'vla'],
    question: 'What are the typical inputs to a VLA policy at inference time?',
    questionZh: '推理时，VLA 策略的典型输入是什么？',
    options: [
      'RGB image(s) and a natural-language task instruction',
      'Only joint torque sensors',
      'A pre-recorded trajectory with no image',
      'Random noise seed only',
    ],
    optionsZh: [
      'RGB 图像 + 自然语言任务指令',
      '仅关节力矩传感器',
      '无图像的预录轨迹',
      '仅随机噪声种子',
    ],
    answer: 0,
  },
  {
    minLevel: 1,
    maxLevel: 2,
    topics: ['openvla', 'vla'],
    question: 'What does a VLA model output for robot control?',
    questionZh: 'VLA 模型为机器人控制输出什么？',
    options: [
      'An action (e.g. end-effector delta, gripper command, or discretized action tokens)',
      'A new camera calibration matrix only',
      'A rewritten abstract of the paper',
      'Only a classification label with no motion',
    ],
    optionsZh: [
      '动作（如末端位姿增量、夹爪指令或离散化的 action token）',
      '仅相机标定矩阵',
      '论文摘要改写',
      '仅分类标签、不含运动',
    ],
    answer: 0,
  },
  {
    minLevel: 1,
    maxLevel: 3,
    topics: ['openvla'],
    question: 'OpenVLA is built by fine-tuning which kind of base model?',
    questionZh: 'OpenVLA 是在哪类基座模型上微调得到的？',
    options: [
      'A large vision-language model (VLM) such as a Prismatic / Llama-style VLM',
      'A pure tabular XGBoost regressor',
      'A classical SLAM pipeline without learning',
      'A text-only GPT with no vision encoder',
    ],
    optionsZh: [
      '大型视觉-语言模型（VLM），如 Prismatic / Llama 风格 VLM',
      '纯表格 XGBoost 回归器',
      '无学习的经典 SLAM 管线',
      '无视觉编码器的纯文本 GPT',
    ],
    answer: 0,
  },
  {
    minLevel: 1,
    maxLevel: 3,
    topics: ['openvla', 'vla'],
    question: 'Why include language instructions in a robot policy?',
    questionZh: '为什么在机器人策略中加入语言指令？',
    options: [
      'To specify tasks in natural language without hand-coding each task ID',
      'To replace the need for any camera input',
      'To guarantee zero sim-to-real gap automatically',
      'To store datasets on disk faster',
    ],
    optionsZh: [
      '用自然语言指定任务，无需为每个任务手写 ID',
      '替代所有相机输入',
      '自动保证零 sim-to-real 差距',
      '加快数据集磁盘写入',
    ],
    answer: 0,
  },
  {
    minLevel: 2,
    maxLevel: 4,
    topics: ['openvla', 'vla'],
    question: 'In OpenVLA, robot actions are often represented as:',
    questionZh: 'OpenVLA 中，机器人动作通常表示为：',
    options: [
      'Discretized tokens appended to the language model vocabulary',
      'Raw JPEG bytes in the prompt',
      'Unbounded floating HTML tags',
      'Only binary success/failure with no continuous control',
    ],
    optionsZh: [
      '离散化 token，加入语言模型词表',
      'prompt 中的原始 JPEG 字节',
      '无界浮点 HTML 标签',
      '仅二值成功/失败、无连续控制',
    ],
    answer: 0,
  },
  {
    minLevel: 2,
    maxLevel: 4,
    topics: ['openvla'],
    question: 'OpenVLA is trained with demonstration data from:',
    questionZh: 'OpenVLA 使用哪类示范数据进行训练？',
    options: [
      'Large-scale robot datasets (e.g. Open X-Embodiment, BridgeData V2)',
      'ImageNet classification labels only',
      'Synthetic text without any robot trajectories',
      'Human speech transcripts without images',
    ],
    optionsZh: [
      '大规模机器人数据集（如 Open X-Embodiment、BridgeData V2）',
      '仅 ImageNet 分类标签',
      '无机器人轨迹的合成文本',
      '无图像的人类语音转写',
    ],
    answer: 0,
  },
  {
    minLevel: 2,
    maxLevel: 5,
    topics: ['openvla', 'vla'],
    question: 'Compared to training a VLA from scratch, fine-tuning a VLM is attractive because:',
    questionZh: '相比从零训练 VLA，微调 VLM 的优势是：',
    options: [
      'It reuses strong visual and linguistic priors learned at scale',
      'It removes the need for any robot data',
      'It eliminates GPU memory use entirely',
      'It guarantees perfect generalization to every robot morphology',
    ],
    optionsZh: [
      '复用大规模预训练得到的视觉与语言先验',
      '完全不需要机器人数据',
      '彻底消除 GPU 显存占用',
      '保证对所有机器人形态完美泛化',
    ],
    answer: 0,
  },
  {
    minLevel: 3,
    maxLevel: 5,
    topics: ['openvla'],
    question: 'When deploying OpenVLA on a new robot, a common practical step is:',
    questionZh: '在新机器人上部署 OpenVLA 时，常见实践步骤是：',
    options: [
      'Fine-tune (often with LoRA) on target-domain demonstrations',
      'Delete the vision encoder and run text-only',
      'Replace actions with keyboard events only',
      'Skip alignment between action space and hardware interface',
    ],
    optionsZh: [
      '在目标域示范数据上微调（常用 LoRA）',
      '删除视觉编码器、仅跑文本',
      '用键盘事件替代动作',
      '跳过动作空间与硬件接口的对齐',
    ],
    answer: 0,
  },
  {
    minLevel: 3,
    maxLevel: 5,
    topics: ['openvla', 'vla'],
    question: 'A key inference bottleneck for VLAs on real robots is often:',
    questionZh: '真实机器人上 VLA 推理的常见瓶颈是：',
    options: [
      'Autoregressive decoding latency and camera–control loop frequency',
      'Reading the PDF from arXiv',
      'Sorting the Zotero library alphabetically',
      'Parsing Markdown task lists',
    ],
    optionsZh: [
      '自回归解码延迟 + 相机–控制环频率',
      '从 arXiv 读取 PDF',
      'Zotero 库按字母排序',
      '解析 Markdown 任务列表',
    ],
    answer: 0,
  },
  {
    minLevel: 1,
    maxLevel: 5,
    topics: ['openvla', 'vla'],
    question: 'Reading the OpenVLA paper abstract first helps you:',
    questionZh: '先读 OpenVLA 摘要的作用是：',
    options: [
      'Judge whether to invest full reading time before diving into methods',
      'Avoid checking the GitHub repo entirely',
      'Skip understanding the action parameterization',
      'Replace hands-on inference experiments',
    ],
    optionsZh: [
      '在深入方法前判断是否值得精读全文',
      '完全不看 GitHub 仓库',
      '跳过 action 参数化理解',
      '替代动手推理实验',
    ],
    answer: 0,
  },
];

const VALID_QUIZ_LANGUAGES = new Set(['auto', 'bi-ch&en', 'eng-only']);

function normalizeQuizLanguage(mode) {
  const m = String(mode || 'auto').trim();
  return VALID_QUIZ_LANGUAGES.has(m) ? m : 'auto';
}

function shouldUseChinese(quizLanguage, level) {
  const mode = normalizeQuizLanguage(quizLanguage);
  if (mode === 'eng-only') return false;
  if (mode === 'bi-ch&en') return true;
  return level <= 2;
}

function formatBilingualLine(english, chinese, useChinese) {
  if (!useChinese || !chinese) return english;
  return `${english}\n（${chinese}）`;
}

function formatQuestionForDisplay(q, level, quizLanguage) {
  const useChinese = shouldUseChinese(quizLanguage, level);
  const question = formatBilingualLine(q.question, q.questionZh, useChinese);
  const options = q.options.map((opt, i) =>
    formatBilingualLine(opt, q.optionsZh?.[i], useChinese)
  );
  return { question, options };
}

function topicMatches(question, topicLower) {
  if (!question.topics || question.topics.length === 0) return true;
  for (let i = 0; i < question.topics.length; i++) {
    const key = question.topics[i].toLowerCase();
    if (topicLower.includes(key) || key.includes(topicLower)) return true;
  }
  return false;
}

function getQuestionForTopic(topicName, level, quizLanguage = 'auto') {
  const topicLower = topicName.toLowerCase();
  const lang = normalizeQuizLanguage(quizLanguage);

  let pool = QUESTIONS.filter(
    (q) => level >= q.minLevel && level <= q.maxLevel && topicMatches(q, topicLower)
  );
  if (pool.length === 0) {
    pool = QUESTIONS.filter((q) => level >= q.minLevel && level <= q.maxLevel);
  }
  if (pool.length === 0) pool = QUESTIONS;

  let hash = 0;
  const seed = `${topicLower}-${new Date().toISOString().slice(0, 10)}`;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const idx = hash % pool.length;
  const q = pool[idx];
  const display = formatQuestionForDisplay(q, level, lang);

  return {
    question: display.question,
    options: display.options,
    answer: q.answer,
    questionEn: q.question,
    topicHint: `Topic: ${topicName} | Level: ${level}/5 | Quiz: ${lang}`,
  };
}

module.exports = {
  getQuestionForTopic,
  normalizeQuizLanguage,
  VALID_QUIZ_LANGUAGES,
};
