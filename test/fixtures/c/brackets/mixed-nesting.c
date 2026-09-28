#include <stdio.h>

struct point {
    int x;
    int y;
};

typedef int (*callback)(void *ctx, const char *name);

static const int table[] = {
    1, 2, 3,
    4, 5, 6,
};

int compute(int n)
{
    int acc = 0;
    for (int i = 0; i < n; ++i) {
        if (i % 2 == 1) {
            acc += table[i % 3];
        }
        else
        {
            acc -= 1;
        }
    }
    return acc;
}

int main(void)
{
    callback cb = 0;
    printf("%d %s\n",
           compute(3),
           "done");
    return cb == 0 ? 0 : 1;
}
