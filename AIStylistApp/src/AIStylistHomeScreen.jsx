import React, { useCallback, useEffect, useState } from "react";

const closetDatabase = [
  // TOPS
  {
    id: "t1",
    name: "Classic White Tee",
    category: "Top",
    primaryColor: "White",
    vibeTags: ["Casual", "Office"],
    season: ["Spring", "Summer", "Fall", "Winter"],
    imageUrl: "https://placehold.co/400x500/f8f9fa/111827?text=White+Tee"
  },
  {
    id: "t2",
    name: "Black Silk Camisole",
    category: "Top",
    primaryColor: "Black",
    vibeTags: ["Night Out", "Date Night"],
    season: ["Spring", "Summer", "Fall"],
    imageUrl: "https://placehold.co/400x500/111827/ffffff?text=Black+Cami"
  },
  {
    id: "t3",
    name: "Light Blue Button-Down",
    category: "Top",
    primaryColor: "Blue",
    vibeTags: ["Office", "Casual"],
    season: ["Spring", "Summer", "Fall", "Winter"],
    imageUrl: "https://placehold.co/400x500/e0f2fe/111827?text=Blue+Button+Down"
  },

  // BOTTOMS
  {
    id: "b1",
    name: "Levi's 501 Straight Jeans",
    category: "Bottom",
    primaryColor: "Blue",
    vibeTags: ["Casual", "Date Night"],
    season: ["Spring", "Summer", "Fall", "Winter"],
    imageUrl: "https://placehold.co/400x500/1d4ed8/ffffff?text=Blue+Jeans"
  },
  {
    id: "b2",
    name: "Tailored Black Trousers",
    category: "Bottom",
    primaryColor: "Black",
    vibeTags: ["Office", "Night Out"],
    season: ["Spring", "Fall", "Winter"],
    imageUrl: "https://placehold.co/400x500/000000/ffffff?text=Black+Trousers"
  },
  {
    id: "b3",
    name: "Beige Midi Skirt",
    category: "Bottom",
    primaryColor: "Beige",
    vibeTags: ["Office", "Casual", "Date Night"],
    season: ["Spring", "Summer"],
    imageUrl: "https://placehold.co/400x500/f5f5dc/111827?text=Beige+Skirt"
  },

  // OUTERWEAR
  {
    id: "o1",
    name: "Navy Blue Blazer",
    category: "Outerwear",
    primaryColor: "Navy",
    vibeTags: ["Office", "Date Night"],
    season: ["Spring", "Fall", "Winter"],
    imageUrl: "https://placehold.co/400x500/1e3a8a/ffffff?text=Navy+Blazer"
  },
  {
    id: "o2",
    name: "Black Leather Moto Jacket",
    category: "Outerwear",
    primaryColor: "Black",
    vibeTags: ["Casual", "Night Out"],
    season: ["Spring", "Fall"],
    imageUrl: "https://placehold.co/400x500/111827/ffffff?text=Leather+Jacket"
  }
];

const vibeOptions = [
  { label: "Office", icon: "business_center" },
  { label: "Casual", icon: "local_cafe" },
  { label: "Night Out", icon: "wine_bar" },
  { label: "Date Night", icon: "favorite" },
];

const selectedChipClass =
  "px-5 py-2.5 rounded-full bg-primary text-white text-sm font-medium shadow-md transition-transform active:scale-95 flex items-center gap-2";

const unselectedChipClass =
  "px-5 py-2.5 rounded-full bg-white border border-gray-200 text-text-sub dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-2";

const pickRandom = (items) => items[Math.floor(Math.random() * items.length)];

export default function AIStylistHomeScreen() {
  const [selectedVibe, setSelectedVibe] = useState("Office");
  const [currentOutfit, setCurrentOutfit] = useState({
    Top: null,
    Bottom: null,
    Outerwear: null,
  });

  const [temperature] = useState("72°F");
  const [weatherText] = useState("Sunny in New York");

  const generateOutfit = useCallback(() => {
    const filteredByVibe = closetDatabase.filter((item) =>
      item.vibeTags.includes(selectedVibe)
    );

    const selectByCategory = (category) => {
      const vibeMatches = filteredByVibe.filter((item) => item.category === category);
      if (vibeMatches.length > 0) return pickRandom(vibeMatches);

      const fallback = closetDatabase.filter((item) => item.category === category);
      return fallback.length > 0 ? pickRandom(fallback) : null;
    };

    setCurrentOutfit({
      Top: selectByCategory("Top"),
      Bottom: selectByCategory("Bottom"),
      Outerwear: selectByCategory("Outerwear"),
    });
  }, [selectedVibe]);

  useEffect(() => {
    generateOutfit();
  }, [generateOutfit]);

  return (
    <div className="w-full max-w-md h-full min-h-screen bg-background-light dark:bg-background-dark relative flex flex-col shadow-2xl overflow-hidden">
      <header className="pt-8 px-6 pb-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-full bg-cover bg-center border border-gray-200 dark:border-gray-700"
            data-alt="Portrait of Sarah"
            style={{
              backgroundImage:
                "url('https://lh3.googleusercontent.com/aida-public/AB6AXuB0PwO0B5z_qit1meYd7oXJlawzsz5kaLmhtYb6_6reTXu91WyE4jXYAOa7cut8l3QDNZAK15ATDlzLl4VXGhGeov87eX7OzHuN2KQWnyVn9nc0OIFKSM8-obuzN0_dnajpR_xLR_P0cPkQ9WJUjXzIHl2o-V59pKUU4m928slMwTX_z51M0-1tMmzbdc23zuXmWMAptODCt-wjsF1DGSN4AZ6CEK5kOyv5-xc2zpI9lhkz5xiRlIbxVM9SV94FQzqIrS95YeOOmww')",
            }}
          />
          <div className="flex flex-col">
            <span className="text-xs font-medium text-text-sub dark:text-slate-400 uppercase tracking-wider">
              Good Morning
            </span>
            <h1 className="text-2xl font-serif font-bold text-primary dark:text-white leading-tight">
              Sarah
            </h1>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="flex items-center gap-1 text-primary dark:text-white">
            <span className="material-symbols-outlined text-[20px]">sunny</span>
            <span className="text-lg font-semibold">{temperature}</span>
          </div>
          <span className="text-xs text-text-sub dark:text-slate-400">{weatherText}</span>
        </div>
      </header>

      <div className="px-6 py-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400">
            search
          </span>
          <input
            className="w-full pl-10 pr-4 py-3 bg-secondary dark:bg-slate-800 rounded-xl text-sm border-none focus:ring-1 focus:ring-primary/20 placeholder-gray-400 dark:placeholder-slate-500"
            placeholder="Search your wardrobe..."
            type="text"
          />
        </div>
      </div>

      <div className="pl-6 py-2 overflow-x-auto no-scrollbar whitespace-nowrap mask-linear-fade">
        <div className="flex gap-3 pr-6">
          {vibeOptions.map((vibe) => {
            const isSelected = selectedVibe === vibe.label;
            return (
              <button
                key={vibe.label}
                className={isSelected ? selectedChipClass : unselectedChipClass}
                onClick={() => setSelectedVibe(vibe.label)}
              >
                <span className="material-symbols-outlined text-[18px]">{vibe.icon}</span>
                {vibe.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col px-6 pt-4 pb-24 overflow-y-auto no-scrollbar">
        <div className="flex justify-between items-end mb-4">
          <h2 className="text-lg font-bold text-primary dark:text-white">Today's Outfit</h2>
          <button className="text-xs font-medium text-text-sub dark:text-slate-400 hover:text-primary transition-colors flex items-center gap-0.5">
            Edit Preferences{" "}
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </button>
        </div>

        <div className="relative flex-1 bg-secondary/50 dark:bg-slate-800/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-6 border border-gray-100 dark:border-slate-700 shadow-inner">
          <div className="relative w-full aspect-[4/3] flex items-center justify-center group">
            <div className="absolute inset-0 bg-white/60 dark:bg-slate-700/60 rounded-xl blur-xl group-hover:bg-white/80 transition-all duration-500" />
            {currentOutfit.Outerwear && (
              <>
                <img
                  alt={currentOutfit.Outerwear.name}
                  className="relative h-full object-contain drop-shadow-lg z-10 transform group-hover:-translate-y-1 transition-transform duration-300"
                  src={currentOutfit.Outerwear.imageUrl}
                />
                <div className="absolute bottom-2 right-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-medium text-text-sub shadow-sm z-20">
                  {currentOutfit.Outerwear.name}
                </div>
              </>
            )}
          </div>

          <div className="relative w-full aspect-[4/2] flex items-center justify-center -mt-8 z-20 group">
            {currentOutfit.Top && (
              <>
                <img
                  alt={currentOutfit.Top.name}
                  className="relative h-full object-contain drop-shadow-md transform group-hover:-translate-y-1 transition-transform duration-300"
                  src={currentOutfit.Top.imageUrl}
                />
                <div className="absolute bottom-0 right-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-medium text-text-sub shadow-sm">
                  {currentOutfit.Top.name}
                </div>
              </>
            )}
          </div>

          <div className="relative w-full aspect-[4/3] flex items-center justify-center -mt-6 z-30 group">
            {currentOutfit.Bottom && (
              <>
                <img
                  alt={currentOutfit.Bottom.name}
                  className="relative h-full object-contain drop-shadow-xl transform group-hover:-translate-y-1 transition-transform duration-300"
                  src={currentOutfit.Bottom.imageUrl}
                />
                <div className="absolute bottom-4 right-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-medium text-text-sub shadow-sm">
                  {currentOutfit.Bottom.name}
                </div>
              </>
            )}
          </div>

          <div className="absolute top-4 left-4 bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-600 rounded-lg p-2 flex items-start gap-2 max-w-[160px] shadow-sm">
            <span className="material-symbols-outlined text-indigo-500 text-[16px] mt-0.5">
              auto_awesome
            </span>
            <p className="text-[10px] leading-tight text-text-sub dark:text-slate-400">
              Perfect for your 2PM meeting and {temperature} weather.
            </p>
          </div>
        </div>

        <div className="flex gap-4 mt-6">
          <button
            className="flex-1 py-4 px-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-text-main dark:text-white font-semibold shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2 group"
            onClick={generateOutfit}
          >
            <span className="material-symbols-outlined text-gray-400 group-hover:rotate-180 transition-transform duration-500">
              refresh
            </span>
            Shuffle
          </button>
          <button
            className="flex-[2] py-4 px-4 rounded-xl bg-primary hover:bg-gray-900 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-semibold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 transform active:scale-95"
            onClick={() => alert("Outfit saved to history!")}
          >
            <span className="material-symbols-outlined">checkroom</span>
            Wear This
          </button>
        </div>
      </div>

      <nav className="absolute bottom-0 left-0 w-full bg-background-light dark:bg-background-dark border-t border-gray-100 dark:border-slate-800 px-6 pb-6 pt-3 flex justify-between items-end z-50 shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)]">
        <a className="flex flex-col items-center gap-1 group w-16" href="#">
          <div className="flex items-center justify-center h-8 w-12 rounded-full bg-primary/10 dark:bg-indigo-500/20 text-primary dark:text-indigo-400 transition-colors">
            <span className="material-symbols-outlined text-[24px]">home</span>
          </div>
          <span className="text-[10px] font-semibold text-primary dark:text-indigo-400">
            Home
          </span>
        </a>
        <a
          className="flex flex-col items-center gap-1 group w-16 text-gray-400 dark:text-slate-500 hover:text-text-main dark:hover:text-slate-300 transition-colors"
          href="#"
        >
          <div className="flex items-center justify-center h-8 w-12 rounded-full group-hover:bg-gray-50 dark:group-hover:bg-slate-800 transition-colors">
            <span className="material-symbols-outlined text-[24px]">styler</span>
          </div>
          <span className="text-[10px] font-medium">Wardrobe</span>
        </a>
        <div className="w-12 h-12 -mt-8 rounded-full bg-primary dark:bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-primary/30 dark:shadow-indigo-500/30 transform hover:scale-110 transition-transform cursor-pointer border-4 border-white dark:border-background-dark">
          <span className="material-symbols-outlined text-[28px]">add</span>
        </div>
        <a
          className="flex flex-col items-center gap-1 group w-16 text-gray-400 dark:text-slate-500 hover:text-text-main dark:hover:text-slate-300 transition-colors"
          href="#"
        >
          <div className="flex items-center justify-center h-8 w-12 rounded-full group-hover:bg-gray-50 dark:group-hover:bg-slate-800 transition-colors">
            <span className="material-symbols-outlined text-[24px]">shopping_bag</span>
          </div>
          <span className="text-[10px] font-medium">Shop</span>
        </a>
        <a
          className="flex flex-col items-center gap-1 group w-16 text-gray-400 dark:text-slate-500 hover:text-text-main dark:hover:text-slate-300 transition-colors"
          href="#"
        >
          <div className="flex items-center justify-center h-8 w-12 rounded-full group-hover:bg-gray-50 dark:group-hover:bg-slate-800 transition-colors">
            <span className="material-symbols-outlined text-[24px]">account_circle</span>
          </div>
          <span className="text-[10px] font-medium">Profile</span>
        </a>
      </nav>
    </div>
  );
}
