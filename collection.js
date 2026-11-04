(function () {
  'use strict';

  const STORAGE_KEY = 'timelog-chris-collection-v1';
  const VERSION = 2;

  const POOLS = {
    nightStandard: {
      key: 'nightStandard',
      title: '睡前普通台词',
      type: 'night',
      special: false
    },
    morningStandard: {
      key: 'morningStandard',
      title: '早晨普通台词',
      type: 'morning',
      special: false
    },
    nightSpecial: {
      key: 'nightSpecial',
      title: '夜间特殊台词',
      type: 'night',
      special: true
    },
    morningSpecial: {
      key: 'morningSpecial',
      title: '早晨特殊台词',
      type: 'morning',
      special: true
    }
  };

  const POOL_ORDER = [
    'nightStandard',
    'morningStandard',
    'nightSpecial',
    'morningSpecial'
  ];

  let activePool = 'nightStandard';

  function emptyState() {
    return {
      version: VERSION,
      unlocked: {
        nightStandard: [],
        morningStandard: [],
        nightSpecial: [],
        morningSpecial: []
      },
      collapsed: false
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function localDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  function readStoredState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.warn('Chris 收藏数据读取失败：', error);
      return null;
    }
  }

  let state = emptyState();

  function normalizeEntries(entries) {
    if (!Array.isArray(entries)) return [];

    const result = [];
    const seen = new Set();

    entries.forEach(entry => {
      let id = null;
      let date = null;

      if (typeof entry === 'string') {
        id = entry;
      } else if (entry && typeof entry === 'object') {
        id = entry.id;
        date = entry.date || null;
      }

      if (!id || seen.has(String(id))) return;

      seen.add(String(id));

      result.push({
        id: String(id),
        date: date ? String(date) : null
      });
    });

    return result;
  }

  function normalizeState(saved) {
    const next = emptyState();

    if (!saved || typeof saved !== 'object') {
      return next;
    }

    const oldUnlocked = saved.unlocked || {};

    POOL_ORDER.forEach(key => {
      next.unlocked[key] = normalizeEntries(oldUnlocked[key]);
    });

    next.collapsed = Boolean(saved.collapsed);

    return next;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Chris 收藏数据保存失败：', error);
    }
  }

  state = normalizeState(readStoredState());

  /*
   * 读取普通台词
   */

  function getStandardLines(type) {
    const source = window.CHRIS_LINES || {};
    const list = source[type];

    return Array.isArray(list)
      ? list.filter(line => line && line.id && line.text)
      : [];
  }

  /*
   * 读取特殊台词
   *
   * 特殊台词不依赖对象是否拥有 type 字段。
   * 根据数据所在的结构路径判断 morning / night。
   */

  function getSpecialLines(type) {
    const source = window.CHRIS_SPECIAL_LINES;

    if (!source || typeof source !== 'object') {
      return [];
    }

    const result = [];
    const seen = new Set();

    function add(line, inferredType) {
      if (!line || typeof line !== 'object') return;
      if (!line.id || !line.text) return;

      const actualType = line.type || inferredType;

      if (actualType !== type) return;

      const id = String(line.id);
      if (seen.has(id)) return;

      seen.add(id);
      result.push(line);
    }

    function inferType(path, inheritedType) {
      const joined = path.join('.').toLowerCase();

      if (
        joined.includes('weekdaymorning') ||
        joined.includes('morning')
      ) {
        return 'morning';
      }

      if (
        joined.includes('specialnight') ||
        joined.includes('night')
      ) {
        return 'night';
      }

      return inheritedType || null;
    }

    function walk(node, path, inheritedType) {
      if (!node) return;

      if (Array.isArray(node)) {
        node.forEach(item => {
          if (item && typeof item === 'object' && item.id && item.text) {
            add(item, inferType(path, inheritedType));
          } else {
            walk(item, path, inheritedType);
          }
        });
        return;
      }

      if (typeof node !== 'object') return;

      if (node.id && node.text) {
        add(node, inferType(path, inheritedType));
        return;
      }

      Object.keys(node).forEach(key => {
        if (key === 'getAll' || key === 'count') return;

        const nextPath = path.concat(key);
        const nextType = inferType(nextPath, inheritedType);

        walk(node[key], nextPath, nextType);
      });
    }

    walk(source, [], null);

    /*
     * 如果模块提供 getAll()，再补充尚未找到的台词。
     * 这部分仅接受自身具有 type 的对象，避免错误归类。
     */

    if (typeof source.getAll === 'function') {
      try {
        const all = source.getAll();

        if (Array.isArray(all)) {
          all.forEach(line => {
            if (line && line.type) add(line, line.type);
          });
        }
      } catch (error) {
        console.warn('读取特殊台词列表失败：', error);
      }
    }

    return result;
  }

  function getAllLines(poolKey) {
    const pool = POOLS[poolKey];
    if (!pool) return [];

    return pool.special
      ? getSpecialLines(pool.type)
      : getStandardLines(pool.type);
  }

  function getLineById(poolKey, id) {
    return getAllLines(poolKey).find(line => String(line.id) === String(id));
  }

  /*
   * 统计收藏进度
   */

  function getProgress(poolKey) {
    const lines = getAllLines(poolKey);
    const unlocked = state.unlocked[poolKey] || [];

    const validIds = new Set(lines.map(line => String(line.id)));
    const unlockedCount = unlocked.filter(item => validIds.has(item.id)).length;

    return {
      total: lines.length,
      unlocked: unlockedCount,
      remaining: Math.max(0, lines.length - unlockedCount),
      percentage: lines.length
        ? Math.round(unlockedCount / lines.length * 100)
        : 0
    };
  }

  function getAllProgress() {
    const result = {};

    POOL_ORDER.forEach(key => {
      result[key] = getProgress(key);
    });

    result.total = {
      total: 0,
      unlocked: 0,
      remaining: 0,
      percentage: 0
    };

    POOL_ORDER.forEach(key => {
      result.total.total += result[key].total;
      result.total.unlocked += result[key].unlocked;
    });

    result.total.remaining = Math.max(
      0,
      result.total.total - result.total.unlocked
    );

    result.total.percentage = result.total.total
      ? Math.round(
          result.total.unlocked / result.total.total * 100
        )
      : 0;

    return result;
  }

  /*
   * 生成特殊日期对应的台词组
   * 优先级：
   * 节日 > 月初/月末 > 特殊星期 > 季节
   */

  function getSpecialGroups(type, date) {
    const source = window.CHRIS_SPECIAL_LINES;

    if (!source) return [];

    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return [];

    const groups = [];

    function addGroup(lines, label) {
      if (!Array.isArray(lines)) return;

      const filtered = lines.filter(line =>
        line && line.id && line.text &&
        (!line.type || line.type === type)
      );

      if (filtered.length) {
        groups.push({
          label,
          lines: filtered
        });
      }
    }

    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekday = d.getDay();

    const monthDay =
      String(month).padStart(2, '0') + '-' +
      String(day).padStart(2, '0');

    // 1. 具体节日
    if (source.holidays && source.holidays[monthDay]) {
      addGroup(source.holidays[monthDay], 'holiday');
    }

    // 2. 月初 / 月末
    if (day === 1 && source.monthStart) {
      addGroup(source.monthStart[type], 'monthStart');
    }

    const lastDay = new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      0
    ).getDate();

    if (day === lastDay && source.monthEnd) {
      addGroup(source.monthEnd[type], 'monthEnd');
    }

    // 3. 特殊星期
    if (type === 'morning' && source.weekdayMorning) {
      addGroup(
        source.weekdayMorning[weekday] ||
        source.weekdayMorning[String(weekday)],
        'weekdayMorning'
      );
    }

    if (type === 'night' && source.specialNight) {
      if (weekday === 5) {
        addGroup(source.specialNight.friday, 'fridayNight');
      }

      if (weekday === 0) {
        addGroup(source.specialNight.sunday, 'sundayNight');
      }
    }

    // 4. 季节
    if (Array.isArray(source.seasons)) {
      source.seasons.forEach(season => {
        if (!season || !Array.isArray(season.months)) return;
        if (!season.months.includes(month)) return;

        if (Array.isArray(season[type])) {
          addGroup(season[type], 'season');
          return;
        }

        if (Array.isArray(season.lines)) {
          const seasonLines = season.lines.filter(line => {
            if (!line || !line.id || !line.text) return false;

            if (line.type) return line.type === type;

            return false;
          });

          addGroup(seasonLines, 'season');
        }
      });
    }

    return groups;
  }

  /*
   * 在一个候选组中抽取一条。
   * 优先抽取尚未解锁的内容。
   */

  function chooseFromGroup(lines, poolKey, date) {
    const unlocked = state.unlocked[poolKey] || [];
    const unlockedIds = new Set(unlocked.map(item => item.id));

    const remaining = lines.filter(line =>
      !unlockedIds.has(String(line.id))
    );

    const candidates = remaining.length ? remaining : lines;

    if (!candidates.length) return null;

    const chosen = candidates[
      Math.floor(Math.random() * candidates.length)
    ];

    const id = String(chosen.id);
    const newlyUnlocked = !unlockedIds.has(id);

    let unlockedDate = null;

    if (newlyUnlocked) {
      unlockedDate = localDateKey(date);

      unlocked.push({
        id,
        date: unlockedDate
      });

      state.unlocked[poolKey] = unlocked;
      saveState();
    } else {
      const existing = unlocked.find(item => item.id === id);
      unlockedDate = existing ? existing.date : null;
    }

    return {
      id,
      text: chosen.text,
      newlyUnlocked,
      unlockedDate,
      poolKey
    };
  }

  /*
   * 对外接口：获取一条台词
   *
   * 只有这个函数会解锁新台词。
   * render() 和其他展示接口不会修改收藏状态。
   */

  function getDialogue(type, date) {
    if (type !== 'morning' && type !== 'night') {
      console.warn('未知 Chris 台词类型：', type);
      return null;
    }

    const d = date instanceof Date ? date : new Date(date || Date.now());

    if (Number.isNaN(d.getTime())) return null;

    const specialPoolKey =
      type === 'morning' ? 'morningSpecial' : 'nightSpecial';

    const standardPoolKey =
      type === 'morning' ? 'morningStandard' : 'nightStandard';

    // 先检查当前日期匹配的特殊台词组
    const specialGroups = getSpecialGroups(type, d);

    for (const group of specialGroups) {
      const available = group.lines.filter(line =>
        line && line.id && line.text
      );

      if (!available.length) continue;

      const result = chooseFromGroup(
        available,
        specialPoolKey,
        d
      );

      if (result) {
        result.group = group.label;
        return result;
      }
    }

    // 没有匹配的特殊台词，使用普通台词池
    const standardLines = getStandardLines(type);

    return chooseFromGroup(
      standardLines,
      standardPoolKey,
      d
    );
  }

  /*
   * 收藏页面
   */

  function render(container) {
    if (!container) return;

    const progress = getAllProgress();
    const total = progress.total;

    let html = `
      <div class="chris-collection">
        <div class="chris-collection-header">
          <div>
            <strong>Chris 台词收藏</strong>
            <div class="chris-collection-total">
              已收集 ${total.unlocked} / ${total.total}
              · ${total.percentage}%
            </div>
          </div>

          <button
            type="button"
            class="chris-collection-collapse"
            data-action="toggle-collapse"
          >
            ${state.collapsed ? '展开收藏列表 ▾' : '收起收藏列表 ▴'}
          </button>
        </div>

        <div class="chris-collection-progress">
          <div
            class="chris-collection-progress-fill"
            style="width:${total.percentage}%"
          ></div>
        </div>
    `;

    if (!state.collapsed) {
      html += `
        <div class="chris-collection-tabs">
      `;

      POOL_ORDER.forEach(key => {
        const pool = POOLS[key];
        const p = progress[key];

        html += `
          <button
            type="button"
            class="chris-collection-tab ${activePool === key ? 'active' : ''}"
            data-pool="${key}"
          >
            ${escapeHTML(pool.title)}
            <span>${p.unlocked}/${p.total}</span>
          </button>
        `;
      });

      html += `</div>`;

      const pool = POOLS[activePool];
      const poolProgress = progress[activePool];
      const lines = getAllLines(activePool);
      const unlocked = state.unlocked[activePool] || [];

      const unlockedMap = new Map(
        unlocked.map(item => [item.id, item])
      );

      html += `
        <div class="chris-collection-pool">
          <div class="chris-collection-pool-heading">
            ${escapeHTML(pool.title)}
            <span>${poolProgress.unlocked} / ${poolProgress.total}</span>
          </div>

          <div class="chris-collection-list">
      `;

      if (!lines.length) {
        html += `
          <div class="chris-collection-empty">
            暂无台词数据，请检查对应的 JS 文件是否加载成功。
          </div>
        `;
      } else {
        lines.forEach((line, index) => {
          const id = String(line.id);
          const record = unlockedMap.get(id);

          if (!record) {
            html += `
              <div class="chris-collection-entry locked">
                <span class="chris-collection-number">
                  ${index + 1}
                </span>
                <span class="chris-collection-question">?</span>
                <span class="chris-collection-status">未解锁</span>
              </div>
            `;
          } else {
            const dateText = record.date
              ? `解锁日期：${escapeHTML(record.date)}`
              : '解锁日期：日期未记录';

            html += `
              <details class="chris-collection-entry unlocked">
                <summary>
                  <span class="chris-collection-number">
                    ${index + 1}
                  </span>
                  <span class="chris-collection-check">✓</span>
                  <span class="chris-collection-id">
                    ${escapeHTML(id)}
                  </span>
                  <span class="chris-collection-status">
                    已收集
                  </span>
                </summary>

                <div class="chris-collection-text">
                  ${escapeHTML(line.text)}
                </div>

                <div class="chris-collection-date">
                  ${dateText}
                </div>
              </details>
            `;
          }
        });
      }

      html += `
          </div>
        </div>
      `;
    }

    html += `</div>`;

    container.innerHTML = html;

    // 折叠 / 展开
    const collapseButton = container.querySelector(
      '[data-action="toggle-collapse"]'
    );

    if (collapseButton) {
      collapseButton.addEventListener('click', function () {
        state.collapsed = !state.collapsed;
        saveState();
        render(container);
      });
    }

    // 收藏池切换
    container.querySelectorAll('[data-pool]').forEach(button => {
      button.addEventListener('click', function () {
        const key = button.getAttribute('data-pool');

        if (!POOLS[key]) return;

        activePool = key;
        render(container);
      });
    });
  }

  /*
   * 状态接口
   */

  function getState() {
    return clone(state);
  }

  function restoreState(saved) {
    // 不传入数据时不覆盖当前收藏
    if (saved === null || saved === undefined) {
      return getState();
    }

    state = normalizeState(saved);
    saveState();

    return getState();
  }

  function resetCollection() {
    state = emptyState();
    saveState();
    return getState();
  }

  function getPools() {
    return clone(POOLS);
  }

  function getStandardCount() {
    return (
      getStandardLines('morning').length +
      getStandardLines('night').length
    );
  }

  function getSpecialCount() {
    return (
      getSpecialLines('morning').length +
      getSpecialLines('night').length
    );
  }

  /*
   * 暴露接口
   */

  window.ChrisCollection = {
    getDialogue,
    render,
    getProgress,
    getAllProgress,
    getState,
    restoreState,
    resetCollection,
    getPools,
    getSpecialCount,
    getStandardCount
  };

  console.log(
    '[ChrisCollection] 已加载',
    '普通台词：' + getStandardCount(),
    '特殊台词：' + getSpecialCount()
  );

})();
