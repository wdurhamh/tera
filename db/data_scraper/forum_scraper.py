import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from typing import List, Dict
import re
import time
import json
import os

class HTMLFetcher:

    def __init__(self, throttle_seconds=5):
        self.time_of_last_request = None
        self.throttle_seconds = throttle_seconds

    def fetch_page(self, url: str) -> str:
        # Throttle requests to avoid hitting servers too hard
        if self.time_of_last_request:
            elapsed = time.time() - self.time_of_last_request
            if elapsed < self.throttle_seconds:
                time.sleep(self.throttle_seconds - elapsed)

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; TripReportBot/1.0)"
        }
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        self.time_of_last_request = time.time()
        return response.text

class KeywordFilters:

    @staticmethod
    def fish(posts: List[Dict]) -> List[Dict]:
        pattern = re.compile(r"\b(trout|fish)\b", re.IGNORECASE)
        return [post for post in posts if pattern.search(post["text"])]

    @staticmethod
    def wind_river(posts: List[Dict]) -> List[Dict]:
        pattern = re.compile(r"\b(wind rivers?|the winds)\b", re.IGNORECASE)
        return [post for post in posts if pattern.search(post["text"])]

    @staticmethod
    def sierras(posts: List[Dict]) -> List[Dict]:
        pattern = re.compile(r"\bsierra?\b", re.IGNORECASE)
        return [post for post in posts if pattern.search(post["text"])]

class ForumScraper:
    def __init__(self, html_fetcher):
        self.seen = None
        self._load_seen()

        self.html_fetcher = html_fetcher

    def _load_seen(self):
        pass
    
    def _save_seen(self, file_path):
        json.dump(list(self.seen), open(file_path, "w"))

    # -----------------------------
    # 4. Processing a Single URL
    # -----------------------------
    def scrape_trip_report(self, url: str) -> List[Dict]:
        try:
            html = self.html_fetcher.fetch_page(url)
            posts = self._parse_posts(html)
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return [], []
        
        fish_posts = KeywordFilters.fish(posts)
        wind_posts = KeywordFilters.wind_river(fish_posts)
        sierras_posts = KeywordFilters.sierras(fish_posts)

        return wind_posts, sierras_posts

    def _parse_posts(self, html: str) -> List[Dict]:
        raise NotImplementedError("Subclasses should implement this method")

    def _get_new_threads(self, links):
        new_links = [l for l in links if l not in self.seen]
        return new_links


class HSTScraper(ForumScraper):
    BASE_URL = "https://www.highsierratopix.com/community/"
    SEEN_FILE = "HST_seen_threads.json"

    def __init__(self, html_scraper, start, stop):
        super().__init__(html_scraper)
        self.start = start
        self.stop = stop

    def work(self, output_file):
        #find new threads
        new_threads = self.crawl_forum()
        #process each of the new threads
        posts = []
        for thread_url in new_threads:
            winds_posts, sierras_posts = self.scrape_trip_report(thread_url)
            # Here you would save the posts to your database or do further processing
            for i, post in enumerate(winds_posts, 1):
                posts.append({"source_url": thread_url,
                "text": post["text"],
                "region_hint": "wind rivers"})

            for i, post in enumerate(sierras_posts, 1):
                posts.append({"source_url": thread_url,
                "text": post["text"],
                "region_hint": "sierra nevada"})
        #save posts out as json
        with open(output_file, "w") as f:
            json.dump(posts, f, indent=2)

    
    def _load_seen(self):
        if not os.path.exists(HSTScraper.SEEN_FILE):
            self.seen =  set()
        else:
            self.seen = set(json.load(open(HSTScraper.SEEN_FILE)))

    def _parse_thread_links(self, html: str) -> list:
        soup = BeautifulSoup(html, "html.parser")
        links = []

        for a in soup.find_all("a", href=True):
            href = a["href"]

            if "viewtopic.php?t=" in href:
                full_url = urljoin(HSTScraper.BASE_URL, href)
                links.append(full_url)
        return list(set(links))
    
    def _parse_posts(self, html: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")

        posts = []

        # High Sierra Topix uses "postbody" class for content
        post_bodies = soup.find_all("div", class_="postbody")

        for post in post_bodies:
            content_div = post.find("div", class_="content")
            if not content_div:
                continue

            text = content_div.get_text(separator="\n", strip=True)

            posts.append({
                "text": text
            })

        return posts

    def crawl_forum(self):
        all_new = []
        for offset in range(self.start, self.stop, 25):  # adjust range as needed
            url = f"{HSTScraper.BASE_URL}viewforum.php?f=1&start={offset}"
            try:
                html = self.html_fetcher.fetch_page(url)
            except Exception as e:
                print(f"Error fetching {url}: {e}")
                break #for now, we are assuming this is the end of the line
            links = self._parse_thread_links(html)

            new_links = self._get_new_threads(links)
                    
            print(f"Found {len(new_links)} new threads on page {offset}")

            all_new.extend(new_links)
            self.seen.update(new_links)

        self._save_seen(HSTScraper.SEEN_FILE)
        return all_new

class BCPScraper(ForumScraper):
    BASE_URL = "https://backcountrypost.com/threads"
    SEEN_FILE = "BCP_seen_threads.json"
    
    def __init__(self):
        super().__init__()

    def _load_seen(self):
        if not os.path.exists(BCPScraper.SEEN_FILE):
            return set()
        return set(json.load(open(BCPScraper.SEEN_FILE)))

    def parse_posts(self, html: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")

        posts = []

        # Backcountry Post uses "article" class for content
        post_bodies = soup.find_all("article")
        for post in post_bodies:
            content_div = post.find("div", class_="bbWrapper")

            if not content_div:
                continue

            text = content_div.get_text(separator="\n", strip=True)

            posts.append({
                "text": text
            })
        return posts

def crawl_hst():
    html_fetcher = HTMLFetcher(throttle_seconds=5)
    batch_size = 500
    max_offset = 10_000
    for start in range(0, max_offset, batch_size):  # adjust range as needed
        scraper = HSTScraper(html_fetcher, start=start, stop=start+batch_size)  # adjust range as needed
        timestamp = int(time.time())
        output_file = f"hst_posts_{timestamp}.json"
        scraper.work(output_file)

if __name__ == "__main__":
    crawl_hst()