import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    "id": "empty nested container: comment 1, follower 1",
    "source": "- :::: box\n  - ::: in\n%%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 1, follower 2",
    "source": "- :::: box\n  - ::: in\n%%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 1, follower 3",
    "source": "- :::: box\n  - ::: in\n%%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 1, follower 4",
    "source": "- :::: box\n  - ::: in\n%%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 2, follower 1",
    "source": "- :::: box\n  - ::: in\n%% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "empty nested container: comment 2, follower 2",
    "source": "- :::: box\n  - ::: in\n%% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 2, follower 3",
    "source": "- :::: box\n  - ::: in\n%% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "empty nested container: comment 2, follower 4",
    "source": "- :::: box\n  - ::: in\n%% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 3, follower 1",
    "source": "- :::: box\n  - ::: in\n %%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 3, follower 2",
    "source": "- :::: box\n  - ::: in\n %%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 3, follower 3",
    "source": "- :::: box\n  - ::: in\n %%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 3, follower 4",
    "source": "- :::: box\n  - ::: in\n %%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 4, follower 1",
    "source": "- :::: box\n  - ::: in\n %% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "empty nested container: comment 4, follower 2",
    "source": "- :::: box\n  - ::: in\n %% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty nested container: comment 4, follower 3",
    "source": "- :::: box\n  - ::: in\n %% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "empty nested container: comment 4, follower 4",
    "source": "- :::: box\n  - ::: in\n %% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 1, follower 1",
    "source": "- ::: box\n%%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 1, follower 2",
    "source": "- ::: box\n%%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 1, follower 3",
    "source": "- ::: box\n%%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 1, follower 4",
    "source": "- ::: box\n%%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 2, follower 1",
    "source": "- ::: box\n%% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "empty container with a continuation claim: comment 2, follower 2",
    "source": "- ::: box\n%% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 2, follower 3",
    "source": "- ::: box\n%% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "empty container with a continuation claim: comment 2, follower 4",
    "source": "- ::: box\n%% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 3, follower 1",
    "source": "- ::: box\n %%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 3, follower 2",
    "source": "- ::: box\n %%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 3, follower 3",
    "source": "- ::: box\n %%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 3, follower 4",
    "source": "- ::: box\n %%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 4, follower 1",
    "source": "- ::: box\n %% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "empty container with a continuation claim: comment 4, follower 2",
    "source": "- ::: box\n %% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "empty container with a continuation claim: comment 4, follower 3",
    "source": "- ::: box\n %% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "empty container with a continuation claim: comment 4, follower 4",
    "source": "- ::: box\n %% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 1, follower 1",
    "source": "- :::: box\n  - ::: in\n    x\n%%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 1, follower 2",
    "source": "- :::: box\n  - ::: in\n    x\n%%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 1, follower 3",
    "source": "- :::: box\n  - ::: in\n    x\n%%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 1, follower 4",
    "source": "- :::: box\n  - ::: in\n    x\n%%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 2, follower 1",
    "source": "- :::: box\n  - ::: in\n    x\n%% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "nested container with paragraph content: comment 2, follower 2",
    "source": "- :::: box\n  - ::: in\n    x\n%% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 2, follower 3",
    "source": "- :::: box\n  - ::: in\n    x\n%% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "nested container with paragraph content: comment 2, follower 4",
    "source": "- :::: box\n  - ::: in\n    x\n%% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 3, follower 1",
    "source": "- :::: box\n  - ::: in\n    x\n %%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 3, follower 2",
    "source": "- :::: box\n  - ::: in\n    x\n %%%\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 3, follower 3",
    "source": "- :::: box\n  - ::: in\n    x\n %%%\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 3, follower 4",
    "source": "- :::: box\n  - ::: in\n    x\n %%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><p>y\nTAILX</p></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 4, follower 1",
    "source": "- :::: box\n  - ::: in\n    x\n %% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul><p>TAILX</p>"
  },
  {
    "id": "nested container with paragraph content: comment 4, follower 2",
    "source": "- :::: box\n  - ::: in\n    x\n %% c\n  x\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul><p>x\nTAILX</p></div></li></ul>"
  },
  {
    "id": "nested container with paragraph content: comment 4, follower 3",
    "source": "- :::: box\n  - ::: in\n    x\n %% c\nTAILX\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "nested container with paragraph content: comment 4, follower 4",
    "source": "- :::: box\n  - ::: in\n    x\n %% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li><div class=\"box\"><ul><li><div class=\"in\"><p>x</p></div></li></ul></div></li></ul>"
  },
  {
    "id": "open item paragraph: comment 1, follower 1",
    "source": "- a\n%%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 1, follower 2",
    "source": "- a\n%%%\n  x\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 1, follower 3",
    "source": "- a\n%%%\nTAILX\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 1, follower 4",
    "source": "- a\n%%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li>a\n    y\nTAILX\n  </li></ul>"
  },
  {
    "id": "open item paragraph: comment 2, follower 1",
    "source": "- a\n%% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li>a\n    <pre><code>    ```\n</code></pre></li></ul><p>TAILX</p>"
  },
  {
    "id": "open item paragraph: comment 2, follower 2",
    "source": "- a\n%% c\n  x\nTAILX\n",
    "html": "<ul><li>a\n    x\nTAILX\n  </li></ul>"
  },
  {
    "id": "open item paragraph: comment 2, follower 3",
    "source": "- a\n%% c\nTAILX\nTAILX\n",
    "html": "<ul><li>a</li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "open item paragraph: comment 2, follower 4",
    "source": "- a\n%% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 3, follower 1",
    "source": "- a\n %%%\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 3, follower 2",
    "source": "- a\n %%%\n  x\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 3, follower 3",
    "source": "- a\n %%%\nTAILX\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "open item paragraph: comment 3, follower 4",
    "source": "- a\n %%%\n%%%\n  y\nTAILX\n",
    "html": "<ul><li>a\n    y\nTAILX\n  </li></ul>"
  },
  {
    "id": "open item paragraph: comment 4, follower 1",
    "source": "- a\n %% c\n  ```\n      ```\nTAILX\n",
    "html": "<ul><li>a\n    <pre><code>    ```\n</code></pre></li></ul><p>TAILX</p>"
  },
  {
    "id": "open item paragraph: comment 4, follower 2",
    "source": "- a\n %% c\n  x\nTAILX\n",
    "html": "<ul><li>a\n    x\nTAILX\n  </li></ul>"
  },
  {
    "id": "open item paragraph: comment 4, follower 3",
    "source": "- a\n %% c\nTAILX\nTAILX\n",
    "html": "<ul><li>a</li></ul><p>TAILX\nTAILX</p>"
  },
  {
    "id": "open item paragraph: comment 4, follower 4",
    "source": "- a\n %% c\n%%%\n  y\nTAILX\n",
    "html": "<ul><li>a</li></ul>"
  },
  {
    "id": "quoted empty nested container: comment 1, follower 1",
    "source": "> - :::: box\n>   - ::: in\n> %%%\n>   ```\n>       ```\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 1, follower 2",
    "source": "> - :::: box\n>   - ::: in\n> %%%\n>   x\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 1, follower 3",
    "source": "> - :::: box\n>   - ::: in\n> %%%\n> TAILX\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 1, follower 4",
    "source": "> - :::: box\n>   - ::: in\n> %%%\n> %%%\n>   y\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>y\nTAILX</p></div></li></ul></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 2, follower 1",
    "source": "> - :::: box\n>   - ::: in\n> %% c\n>   ```\n>       ```\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 2, follower 2",
    "source": "> - :::: box\n>   - ::: in\n> %% c\n>   x\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>x\nTAILX</p></div></li></ul></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 2, follower 3",
    "source": "> - :::: box\n>   - ::: in\n> %% c\n> TAILX\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul><p>TAILX\nTAILX</p></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 2, follower 4",
    "source": "> - :::: box\n>   - ::: in\n> %% c\n> %%%\n>   y\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 3, follower 1",
    "source": "> - :::: box\n>   - ::: in\n>  %%%\n>   ```\n>       ```\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 3, follower 2",
    "source": "> - :::: box\n>   - ::: in\n>  %%%\n>   x\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 3, follower 3",
    "source": "> - :::: box\n>   - ::: in\n>  %%%\n> TAILX\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 3, follower 4",
    "source": "> - :::: box\n>   - ::: in\n>  %%%\n> %%%\n>   y\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>y\nTAILX</p></div></li></ul></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 4, follower 1",
    "source": "> - :::: box\n>   - ::: in\n>  %% c\n>   ```\n>       ```\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><pre><code>    ```\n</code></pre></div></li></ul></blockquote><p>TAILX</p>"
  },
  {
    "id": "quoted empty nested container: comment 4, follower 2",
    "source": "> - :::: box\n>   - ::: in\n>  %% c\n>   x\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul><p>x\nTAILX</p></div></li></ul></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 4, follower 3",
    "source": "> - :::: box\n>   - ::: in\n>  %% c\n> TAILX\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul><p>TAILX\nTAILX</p></blockquote>"
  },
  {
    "id": "quoted empty nested container: comment 4, follower 4",
    "source": "> - :::: box\n>   - ::: in\n>  %% c\n> %%%\n>   y\nTAILX\n",
    "html": "<blockquote><ul><li><div class=\"box\"><ul><li><div class=\"in\"></div></li></ul></div></li></ul></blockquote><p>TAILX</p>"
  }
]

describe('below-column comments require an open paragraph or earlier retention', () => {
  it.each(cases)('$id', ({ source, html }) => {
    expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
  })
})
