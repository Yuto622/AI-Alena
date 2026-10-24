import csv, glob
rows = []
for f in sorted(glob.glob("data/*.csv")):
    with open(f, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            r["region_file"] = f.split("/")[-1]
            rows.append(r)
def sc(r):
    try: return int(r["score"])
    except: return -1
rows.sort(key=lambda r: -sc(r))
fields = list(rows[0].keys())
with open("all_schools_ranked.csv", "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
researched = [r for r in rows if sc(r) > 0]
print("total", len(rows), "scored>0", len(researched))
for f in sorted(set(r["region_file"] for r in rows)):
    rs=[r for r in rows if r["region_file"]==f]; print(f, len(rs), sum(sc(r)>0 for r in rs))
for r in researched[:40]: print(sc(r), r["pref"], r["school_name"], "|", (r["english_course"] or "")[:30])
