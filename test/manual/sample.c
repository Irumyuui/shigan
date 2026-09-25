#include <stdio.h>

#define SQUARE(x) \
    ((x) * (x))

#if defined(DEBUG) && DEBUG > 0
int debug_level = DEBUG;
#elif defined(VERBOSE)
int debug_level = 1;
#else
int debug_level = 0;
#endif

#ifdef FEATURE_A

static void feature_a(void)
{
    int values[] = { 1, 2, 3 };
    if (values[0] == 1) {
        puts("a { } [ ] ) (");
    }
    else
    {
        puts("b");
    }
}

#else

static void feature_a(void)
{
    /* disabled on purpose: { } [ ] ) ( */
    puts("no feature");
}

#endif

#if 0
static void dead(void) {
    /* this brace lives in an inactive branch */
}
#endif

int main(int argc, char **argv)
{
    (void)argc;
    (void)argv;
    feature_a();
    return SQUARE(2);
}
