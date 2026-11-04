
/*
 * TimeLog - Chris Collection Module
 * 文件：collection.js
 *
 * 依赖：
 *   1. chris-lines.js
 *   2. seasonal-lines.js
 *
 * 加载顺序必须是：
 *   chris-lines.js
 *   seasonal-lines.js
 *   collection.js
 *
 * 功能：
 *   - 普通 / 特殊台词分池
 *   - 夜间 / 早晨分池
 *   - 根据日期选择特殊台词
 *   - 优先解锁尚未收集的台词
 *   - 收藏进度本地保存
 *   - 收藏页面渲染
 *   - 支持 JSON 备份和恢复
 */

(function () {
  "use strict";

  // ==========================================
  // 1. 基础数据检查
  // ==========================================

  const STANDARD = window.CHRIS_LINES;
  const SPECIAL = window.CHRIS_SPECIAL_LINES;

  if (!STANDARD || !SPECIAL) {
    console.error(
      "[Chris Collection] Missing dialogue files."
    );
    return;
  }

  const STORAGE_KEY = "timelog-chris-collection-v1";

  const POOLS = {
    nightStandard: {
      title: "夜间普通台词",
      type: "night",
      source: "standard"
    },

    morningStandard: {
      title: "早晨普通台词",
      type: "morning",
      source: "standard"
    },

    nightSpecial: {
      title: "夜间特殊台词",
      type: "night",
      source: "special"
    },

    morningSpecial: {
      title: "早晨特殊台词",
      type: "morning",
      source: "special"
    }
  };


  // ==========================================
  // 2. 收藏状态
  // ==========================================

  function emptyState() {
    return {
      version: 1,

      unlocked: {
        nightStandard: [],
        morningStandard: [],
        nightSpecial: [],
        morningSpecial: []
      }
    };
  }

  let state = emptyState();


  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) return;

      const parsed = JSON.parse(raw);

      if (
        !parsed ||
        !parsed.unlocked ||
        typeof parsed.unlocked !== "object"
      ) {
        return;
      }

      Object.keys(state.unlocked).forEach(pool => {
        const saved = parsed.unlocked[pool];

        if (Array.isArray(saved)) {
          state.unlocked[pool] = [...new Set(saved)];
        }
      });

    } catch (error) {
      console.warn(
        "[Chris Collection] Could not load saved state.",
        error
      );
    }
  }


  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state)
      );
    } catch (error) {
      console.warn(
        "[Chris Collection] Could not save state.",
        error
      );
    }
  }


  loadState();


  // ==========================================
  // 3. 台词池读取
  // ==========================================

  function getStandard(type) {
    const list = STANDARD[type];

    return Array.isArray(list) ? list : [];
  }


  function getSpecial(type) {
    const result = [];

    function add(list) {
      if (!Array.isArray(list)) return;

      list.forEach(line => {
        if (line && line.type === type) {
          result.push(line);
        }
      });
    }

    // 星期早晨
    if (type === "morning") {
      Object.values(SPECIAL.weekdayMorning || {})
        .forEach(add);
    }

    // 周五、周日夜晚
    if (type === "night") {
      Object.values(SPECIAL.specialNight || {})
        .forEach(add);
    }

    // 每月第一天
    add(SPECIAL.monthStart?.[type]);

    // 每月最后一天
    add(SPECIAL.monthEnd?.[type]);

    // 节日
    Object.values(SPECIAL.holidays || {})
      .forEach(day => {
        add(day?.[type]);
      });

    // 季节
    Object.values(SPECIAL.seasons || {})
      .forEach(season => {
        add(season?.[type]);
      });

    // 去重，防止同一 ID 重复进入收藏池
    const unique = new Map();

    result.forEach(line => {
      if (line.id) {
        unique.set(line.id, line);
      }
    });

    return [...unique.values()];
  }


  function getPoolKey(type, source) {
    if (source === "special") {
      return type === "night"
        ? "nightSpecial"
        : "morningSpecial";
    }

    return type === "night"
      ? "nightStandard"
      : "morningStandard";
  }


  function getPool(poolKey) {
    const config = POOLS[poolKey];

    if (!config) return [];

    return config.source === "special"
      ? getSpecial(config.type)
      : getStandard(config.type);
  }


  // ==========================================
  // 4. 日期与季节判断
  // 使用设备本地日期
  // ==========================================

  function getSeason(month) {
    if ([3, 4, 5].includes(month)) {
      return "spring";
    }

    if ([6, 7, 8].includes(month)) {
      return "summer";
    }

    if ([9, 10, 11].includes(month)) {
      return "autumn";
    }

    return "winter";
  }


  function getDateInfo(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = date.getDay();

    const lastDay = new Date(
      year,
      month,
      0
    ).getDate();

    const monthDay =
      String(month).padStart(2, "0") +
      "-" +
      String(day).padStart(2, "0");

    return {
      year,
      month,
      day,
      weekday,
      lastDay,
      monthDay,
      season: getSeason(month)
    };
  }


  // ==========================================
  // 5. 特殊台词优先级
  //
  // 第一优先：节日
  // 第二优先：月初 / 月末
  // 第三优先：特殊星期
  // 第四优先：季节
  //
  // 某一优先级的台词全部收集后，
  // 才会继续尝试较低优先级的台词。
  // 所有匹配的特殊台词都收集后，
  // 才会从最高优先级的特殊池随机重复。
  // ==========================================

  function getSpecialGroups(type, date) {
    const info = getDateInfo(date);
    const groups = [];

    function add(list) {
      if (Array.isArray(list) && list.length) {
        groups.push(list);
      }
    }

    // 第一优先：节日
    const holiday =
      SPECIAL.holidays?.[info.monthDay]?.[type];

    add(holiday);

    // 第二优先：月初 / 月末
    if (info.day === 1) {
      add(SPECIAL.monthStart?.[type]);
    }

    if (info.day === info.lastDay) {
      add(SPECIAL.monthEnd?.[type]);
    }

    // 第三优先：特殊星期
    if (type === "night") {
      if (info.weekday === 5) {
        add(SPECIAL.specialNight?.friday);
      }

      if (info.weekday === 0) {
        add(SPECIAL.specialNight?.sunday);
      }
    }

    if (type === "morning") {
      add(SPECIAL.weekdayMorning?.[info.weekday]);
    }

    // 第四优先：季节
    const season =
      SPECIAL.seasons?.[info.season];

    add(season?.[type]);

    return groups;
  }


  // ==========================================
  // 6. 台词随机抽取
  // ==========================================

  function randomItem(list) {
    if (!list || !list.length) return null;

    return list[
      Math.floor(Math.random() * list.length)
    ];
  }


  function getUnlockedSet(poolKey) {
    return new Set(
      state.unlocked[poolKey] || []
    );
  }


  function getUncollected(list, poolKey) {
    const unlocked = getUnlockedSet(poolKey);

    return list.filter(
      line => !unlocked.has(line.id)
    );
  }


  function unlockLine(line, poolKey) {
    if (!line || !line.id) return;

    const unlocked = state.unlocked[poolKey];

    if (!unlocked.includes(line.id)) {
      unlocked.push(line.id);
      saveState();
    }
  }


  // ==========================================
  // 7. 核心抽取接口
  //
  // 使用：
  // ChrisCollection.getDialogue("morning")
  // ChrisCollection.getDialogue("night")
  //
  // 可选第二参数传入 Date 对象，
  // 方便测试特殊日期。
  // ==========================================

  function getDialogue(type, date = new Date()) {
    if (!["morning", "night"].includes(type)) {
      throw new Error(
        "Dialogue type must be morning or night."
      );
    }

    // 先检查特殊日期
    const specialGroups =
      getSpecialGroups(type, date);

    const specialPoolKey =
      getPoolKey(type, "special");

    // 按优先级逐层寻找尚未解锁的台词
    for (const group of specialGroups) {
      const available =
        getUncollected(group, specialPoolKey);

      if (available.length) {
        const selected = randomItem(available);

        unlockLine(selected, specialPoolKey);

        return {
          ...selected,
          source: "special",
          pool: specialPoolKey,
          newlyUnlocked: true
        };
      }
    }

    // 所有匹配的特殊台词均已解锁：
    // 随机重复最高优先级的特殊台词
    if (specialGroups.length) {
      const selected = randomItem(
        specialGroups[0]
      );

      return {
        ...selected,
        source: "special",
        pool: specialPoolKey,
        newlyUnlocked: false
      };
    }

    // 没有匹配的特殊台词，使用普通台词池
    const standardPoolKey =
      getPoolKey(type, "standard");

    const standardList =
      getStandard(type);

    const available =
      getUncollected(
        standardList,
        standardPoolKey
      );

    // 普通池优先抽取未解锁内容
    if (available.length) {
      const selected = randomItem(available);

      unlockLine(selected, standardPoolKey);

      return {
        ...selected,
        source: "standard",
        pool: standardPoolKey,
        newlyUnlocked: true
      };
    }

    // 普通池全部解锁后随机重复
    const selected = randomItem(standardList);

    if (!selected) return null;

    return {
      ...selected,
      source: "standard",
      pool: standardPoolKey,
      newlyUnlocked: false
    };
  }


  // ==========================================
  // 8. 收藏进度统计
  // ==========================================

  function getProgress(poolKey) {
    const list = getPool(poolKey);
    const unlocked = getUnlockedSet(poolKey);

    const collected = list.filter(
      line => unlocked.has(line.id)
    ).length;

    return {
      collected,
      total: list.length,
      remaining: Math.max(
        0,
        list.length - collected
      ),
      percentage: list.length
        ? Math.round(
            collected / list.length * 100
          )
        : 0
    };
  }


  function getAllProgress() {
    const result = {};

    Object.keys(POOLS).forEach(key => {
      result[key] = getProgress(key);
    });

    const totalCollected = Object.values(result)
      .reduce((sum, item) => sum + item.collected, 0);

    const totalLines = Object.values(result)
      .reduce((sum, item) => sum + item.total, 0);

    return {
      pools: result,
      collected: totalCollected,
      total: totalLines,
      remaining: Math.max(
        0,
        totalLines - totalCollected
      ),
      percentage: totalLines
        ? Math.round(
            totalCollected / totalLines * 100
          )
        : 0
    };
  }


  // ==========================================
  // 9. 收藏页面
  //
  // 使用：
  // ChrisCollection.render(
  //   document.querySelector("#collectionPage")
  // );
  //
  // 四个池子可以独立切换。
  // 未解锁：显示 ?
  // 已解锁：点击展开原文。
  // ==========================================

  let activePool = "nightStandard";


  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }


  function render(container) {
    if (!container) {
      console.warn(
        "[Chris Collection] Collection container not found."
      );
      return;
    }

    const progress = getAllProgress();

    const poolButtons = Object.entries(POOLS)
      .map(([key, config]) => {
        const item = progress.pools[key];

        const active =
          activePool === key ? "active" : "";

        return `
          <button
            type="button"
            class="chris-collection-tab ${active}"
            data-collection-pool="${key}"
          >
            <span>${escapeHTML(config.title)}</span>
            <span>${item.collected}/${item.total}</span>
          </button>
        `;
      })
      .join("");

    const config = POOLS[activePool];
    const currentProgress =
      progress.pools[activePool];

    const unlocked = getUnlockedSet(activePool);
    const list = getPool(activePool);

    const entries = list.map((line, index) => {
      const isUnlocked = unlocked.has(line.id);

      if (!isUnlocked) {
        return `
          <div class="chris-collection-entry locked">
            <span class="chris-collection-number">
              ${String(index + 1).padStart(3, "0")}
            </span>
            <span class="chris-collection-question">?</span>
            <span class="chris-collection-status">
              未解锁
            </span>
          </div>
        `;
      }

      return `
        <details class="chris-collection-entry unlocked">
          <summary>
            <span class="chris-collection-number">
              ${String(index + 1).padStart(3, "0")}
            </span>
            <span class="chris-collection-check">✓</span>
            <span class="chris-collection-status">
              已收藏
            </span>
          </summary>

          <div class="chris-collection-text">
            ${escapeHTML(line.text)}
          </div>

          <div class="chris-collection-id">
            ${escapeHTML(line.id)}
          </div>
        </details>
      `;
    }).join("");

    container.innerHTML = `
      <section class="chris-collection">

        <header class="chris-collection-header">
          <h2>Chris Dialogue Collection</h2>

          <div class="chris-collection-total">
            总收藏进度：
            <strong>
              ${progress.collected}/${progress.total}
            </strong>
          </div>

          <div class="chris-collection-progress">
            <div
              class="chris-collection-progress-fill"
              style="width:${progress.percentage}%"
            ></div>
          </div>
        </header>

        <nav class="chris-collection-tabs">
          ${poolButtons}
        </nav>

        <section class="chris-collection-pool">

          <div class="chris-collection-pool-heading">
            <h3>${escapeHTML(config.title)}</h3>

            <span>
              ${currentProgress.collected}
              /
              ${currentProgress.total}
            </span>
          </div>

          <div class="chris-collection-progress">
            <div
              class="chris-collection-progress-fill"
              style="width:${currentProgress.percentage}%"
            ></div>
          </div>

          <div class="chris-collection-list">
            ${entries}
          </div>

        </section>

      </section>
    `;

    // 绑定四个收藏池的切换
    container.querySelectorAll(
      "[data-collection-pool]"
    ).forEach(button => {
      button.addEventListener("click", () => {
        activePool =
          button.dataset.collectionPool;

        render(container);
      });
    });
  }


  // ==========================================
  // 10. 数据导出与恢复
  //
  // 供 index.html 的 JSON 备份系统调用。
  // 收藏状态不依赖打卡记录。
  // ==========================================

  function getState() {
    return JSON.parse(
      JSON.stringify(state)
    );
  }


  function restoreState(saved) {
    if (
      !saved ||
      !saved.unlocked ||
      typeof saved.unlocked !== "object"
    ) {
      return false;
    }

    const next = emptyState();

    Object.keys(next.unlocked).forEach(poolKey => {
      const values = saved.unlocked[poolKey];

      if (Array.isArray(values)) {
        const validIds = new Set(
          getPool(poolKey).map(line => line.id)
        );

        next.unlocked[poolKey] = [
          ...new Set(
            values.filter(id =>
              typeof id === "string" &&
              validIds.has(id)
            )
          )
        ];
      }
    });

    state = next;
    saveState();

    return true;
  }


  function resetCollection() {
    state = emptyState();
    saveState();
  }


  // ==========================================
  // 11. 对外公开接口
  // ==========================================

  window.ChrisCollection = {

    // 抽取一条台词
    getDialogue,

    // 收藏页面
    render,

    // 进度
    getProgress,
    getAllProgress,

    // 数据备份与恢复
    getState,
    restoreState,

    // 全部清空
    resetCollection,

    // 当前收藏池
    getPools: () => ({ ...POOLS }),

    // 特殊台词数量
    getSpecialCount: () => getSpecial("night").length +
      getSpecial("morning").length,

    // 普通台词数量
    getStandardCount: () => getStandard("night").length +
      getStandard("morning").length
  };


  console.log(
    "[Chris Collection] Ready.",
    getAllProgress()
  );

})();
